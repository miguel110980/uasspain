/** Final tooling/secret/diff gates. No staging, commit, push or data writes. */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const checks = [];
function run(file, args) { const r = spawnSync(file, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 }); return { exit: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: !!r.error }; }
const syntax = readdirSync(resolve(root, 'scripts/audit')).filter(x => x.endsWith('.mjs')).map(file => ({ file, exit: run(process.execPath, ['--check', 'scripts/audit/' + file]).exit }));
checks.push({ id: 'AUDIT_SCRIPT_SYNTAX', status: syntax.every(x => x.exit === 0) ? 'PASS' : 'FAIL', files: syntax });
const pythonSyntax = run('python', ['-c', "import ast,pathlib; ast.parse(pathlib.Path('scripts/audit/strict-tls-readonly.py').read_text(encoding='utf-8'))"]);
checks.push({ id: 'AUDIT_PYTHON_SYNTAX', status: pythonSyntax.exit === 0 ? 'PASS' : 'FAIL', exit: pythonSyntax.exit });
const psSyntax = run('powershell.exe', ['-NoProfile', '-Command', "$uasFailed=$false;Get-ChildItem -LiteralPath 'scripts/audit' -Filter '*.ps1' -File | ForEach-Object {$uasTokens=$null;$uasErrors=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$uasTokens,[ref]$uasErrors);if($uasErrors.Count -gt 0){$uasFailed=$true}};if($uasFailed){exit 1}"]);
checks.push({ id: 'AUDIT_POWERSHELL_SYNTAX', status: psSyntax.exit === 0 ? 'PASS' : 'FAIL', exit: psSyntax.exit });
for (const path of ['scripts/audit', 'docs/audits']) {
  const r = run(resolve(root, '.run/audit-tools/gitleaks-v8.30.1/gitleaks.exe'), ['dir', path, '--config', '.gitleaks.toml', '--redact', '--no-banner', '--no-color']);
  checks.push({ id: 'SECRETS:' + path, status: r.exit === 0 ? 'PASS' : r.exit === 1 ? 'FAIL' : 'BLOCKED', exit: r.exit, scope: 'Current directory content only; not all repository files or history', findings: r.exit === 0 ? 0 : 'NOT_ASSUMED' });
}
for (const [id, args] of [['WORKTREE_DIFF_CHECK', ['diff', '--check']], ['INDEX_DIFF_CHECK', ['diff', '--cached', '--check']]]) {
  const r = run('git', args); checks.push({ id, status: r.exit === 0 ? 'PASS' : 'FAIL', exit: r.exit });
}
const staged = run('git', ['diff', '--cached', '--name-only']);
checks.push({ id: 'NO_STAGED_FILES', status: staged.exit === 0 && !staged.stdout.trim() ? 'PASS' : 'BLOCKED', index_empty: !staged.stdout.trim(), note: 'An empty-index diff check does not certify a future staged commit' });
const head = run('git', ['rev-parse', 'HEAD']);
const remote = run('git', ['ls-remote', 'origin', 'refs/heads/main', 'refs/heads/codex/auditoria-20261110']);
const refs = Object.fromEntries(remote.stdout.trim().split('\n').filter(Boolean).map(line => { const [sha, ref] = line.trim().split(/\s+/); return [ref, sha]; }));
checks.push({ id: 'EXISTING_GIT_REFERENCE', status: head.exit === 0 && remote.exit === 0 && refs['refs/heads/codex/auditoria-20261110'] === head.stdout.trim() ? 'PASS' : 'BLOCKED', local_head: head.stdout.trim(), remote_refs: refs, new_commit: 'NOT_RUN', new_push: 'NOT_RUN', limits: 'New uncommitted files are not published; no claim of HEAD matching main' });
const evidence = {};
for (const name of ['readonly-post-update', 'security-post-update', 'preupdate-backup', 'existing-lab', 'lab-api', 'lab-browser', 'lab-realtime', 'lab-retirement', 'public-map', 'external-mail', 'lab-performance', 'lab-media', 'strict-tls', 'continuation', 'public-route', 'network-preflight', 'network-verified', 'duckdns-response', 'public-google-preflight', 'public-after-network', 'router-after', 'network-server-live', 'network-assets-live', 'google-public-apply', 'google-public-guards', 'google-backend-security', 'google-public-closure', 'google-public-guards-verified']) {
  const path = 'docs/audits/evidence/2026-11-16-' + name + '.json';
  const data = JSON.parse(readFileSync(resolve(root, path), 'utf8').replace(/^\uFEFF/, ''));
  evidence[name] = { path, status: data.status || 'SEE_CASES', counts: data.checks?.reduce((a,x) => ({ ...a, [x.status]: (a[x.status] || 0) + 1 }), {}), completed_at: data.completed_at || data.observed_at, source_sha256: name === 'readonly-post-update' ? data.source_inputs : undefined };
}
const report = { observed_at: new Date().toISOString(), status: checks.every(x => x.status === 'PASS') ? 'PASS' : 'BLOCKED', scope: 'Audit tooling and publication prechecks only; does not certify platform release', checks, evidence, release_gate: 'BLOCKED', commit: 'NOT_RUN', push: 'NOT_RUN' };
writeFileSync(resolve(root, 'docs/audits/evidence/2026-11-16-final-gates.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, checks: checks.map(({id,status}) => ({id,status})), scripts: syntax.length }));
if (report.status !== 'PASS') process.exitCode = 1;
