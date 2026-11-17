//! Bounded, stdin/stdout-only legacy Word reader. Never launches Office.
use std::io::{Read, Write};

#[derive(serde::Serialize)]
struct Line {
    text: String,
    bold: bool,
    color: Option<String>,
}

fn visit(
    blocks: &[rwml::Block],
    lines: &mut Vec<Line>,
    bytes: &mut usize,
    depth: usize,
) -> Result<(), String> {
    if depth > 32 {
        return Err("document depth".into());
    }
    for block in blocks {
        match block {
            rwml::Block::Paragraph(paragraph) => {
                let text = paragraph.text();
                *bytes = bytes.checked_add(text.len()).ok_or("text size")?;
                if *bytes > 2 * 1024 * 1024 || lines.len() >= 20000 {
                    return Err("document size".into());
                }
                let prefix: Vec<char> = text.trim().chars().take(2).collect();
                let mut skip = if prefix.len() == 2
                    && matches!(prefix[0].to_ascii_lowercase(), 'a'..='d')
                    && matches!(prefix[1], '.' | ')' | ':' | '-')
                {
                    2
                } else {
                    0
                };
                let (mut visible, mut bold_chars, mut colors) = (
                    0usize,
                    0usize,
                    std::collections::BTreeMap::<String, usize>::new(),
                );
                for run in &paragraph.runs {
                    for _ in run.text.chars().filter(|c| !c.is_whitespace()) {
                        if skip > 0 {
                            skip -= 1;
                            continue;
                        }
                        visible += 1;
                        if run.props.bold {
                            bold_chars += 1;
                        }
                        if let Some(color) = &run.props.color {
                            *colors
                                .entry(format!("{:02X}{:02X}{:02X}", color.r, color.g, color.b))
                                .or_default() += 1;
                        }
                    }
                }
                let bold = visible > 0 && bold_chars * 5 >= visible * 4;
                let color = colors
                    .into_iter()
                    .find(|(color, count)| color != "000000" && count * 5 >= visible * 4)
                    .map(|(color, _)| color);
                lines.push(Line { text, bold, color });
            }
            rwml::Block::Table(table) => {
                for row in &table.rows {
                    for cell in &row.cells {
                        visit(&cell.blocks, lines, bytes, depth + 1)?;
                    }
                }
            }
            _ => {}
        }
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn restrict() -> Result<(), String> {
    use seccompiler::{BpfProgram, SeccompAction, SeccompFilter};
    let calls = [
        libc::SYS_read,
        libc::SYS_write,
        libc::SYS_readv,
        libc::SYS_writev,
        libc::SYS_close,
        libc::SYS_fstat,
        libc::SYS_lseek,
        libc::SYS_pread64,
        libc::SYS_fcntl,
        libc::SYS_brk,
        libc::SYS_mmap,
        libc::SYS_munmap,
        libc::SYS_mprotect,
        libc::SYS_madvise,
        libc::SYS_mremap,
        libc::SYS_rt_sigaction,
        libc::SYS_rt_sigprocmask,
        libc::SYS_rt_sigreturn,
        libc::SYS_sigaltstack,
        libc::SYS_futex,
        libc::SYS_clock_gettime,
        libc::SYS_getrandom,
        libc::SYS_getpid,
        libc::SYS_gettid,
        libc::SYS_sched_yield,
        libc::SYS_exit,
        libc::SYS_exit_group,
    ];
    let filter = SeccompFilter::new(
        calls.into_iter().map(|call| (call, vec![])).collect(),
        SeccompAction::Errno(libc::EPERM as u32),
        SeccompAction::Allow,
        std::env::consts::ARCH
            .try_into()
            .map_err(|_| "architecture")?,
    )
    .map_err(|_| "filter")?;
    let program: BpfProgram = filter.try_into().map_err(|_| "filter compilation")?;
    seccompiler::apply_filter(&program).map_err(|_| "filter activation".into())
}

#[cfg(not(target_os = "linux"))]
fn restrict() -> Result<(), String> {
    Err("isolated DOC conversion requires Linux seccomp".into())
}

fn run() -> Result<(), String> {
    let probe = std::env::args().any(|arg| arg == "--probe");
    let probe_path = format!("/tmp/uasspain-doc-probe-{}", std::process::id());
    let mut bytes = Vec::new();
    std::io::stdin()
        .take(20 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "input")?;
    if bytes.len() > 20 * 1024 * 1024 {
        return Err("input size".into());
    }
    restrict()?;
    if probe {
        let denied = |result: std::io::Result<()>| {
            result.is_err_and(|error| error.kind() == std::io::ErrorKind::PermissionDenied)
        };
        let checks = [
            denied(std::fs::read("/etc/passwd").map(|_| ())),
            denied(
                std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&probe_path)
                    .map(|_| ()),
            ),
            denied(std::fs::remove_file(&probe_path)),
            denied(std::net::TcpStream::connect("127.0.0.1:9").map(|_| ())),
            denied(std::process::Command::new("/bin/true").status().map(|_| ())),
        ];
        if !checks.into_iter().all(|value| value) {
            return Err("isolation probe".into());
        }
        return std::io::stdout().write_all(b"{\"filesystem_read\":false,\"filesystem_write\":false,\"filesystem_delete\":false,\"network\":false,\"spawn\":false}").map_err(|_|"output".into());
    }
    if !bytes.starts_with(&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) {
        return Err("DOC signature".into());
    }
    let compound =
        cfb::CompoundFile::open(std::io::Cursor::new(&bytes)).map_err(|_| "compound file")?;
    for (index, entry) in compound.walk().enumerate() {
        let path = entry.path().to_string_lossy().to_lowercase();
        if index >= 4096
            || entry.len() > 20 * 1024 * 1024
            || [
                "vba",
                "macros",
                "objectpool",
                "encryptedpackage",
                "encryptioninfo",
            ]
            .iter()
            .any(|name| path.contains(name))
        {
            return Err("active or oversized content".into());
        }
    }
    let document = rwml::Document::open(&bytes).map_err(|_| "DOC parser")?;
    let mut lines = Vec::new();
    let mut length = 0;
    visit(&document.model().blocks, &mut lines, &mut length, 0)?;
    let output = serde_json::to_vec(&lines).map_err(|_| "output")?;
    if output.len() > 3 * 1024 * 1024 {
        return Err("output size".into());
    }
    std::io::stdout()
        .write_all(&output)
        .map_err(|_| "output".into())
}

fn main() {
    if run().is_err() {
        eprintln!("DOC rejected or isolation unavailable");
        std::process::exit(2);
    }
}
