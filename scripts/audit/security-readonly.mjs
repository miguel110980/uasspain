/** Existing scanners only. No installation, audit fix, image build or deployment. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const privateDir = resolve(root, '.run/audit-20261116');
const phase = process.argv.includes('--post-update') ? 'post-update' : process.argv.includes('--candidate') ? 'candidate' : 'initial';
const imagesOnly = process.argv.includes('--images-only');
const output = resolve(root, process.argv.includes('--video-repair') ? 'docs/audits/evidence/2026-11-17-video-repair-security.json' : `docs/audits/evidence/2026-11-16-security${phase === 'initial' ? '' : '-' + phase}.json`);
mkdirSync(privateDir, { recursive: true });
const report = { started_at: new Date().toISOString(), phase, scope: 'Current dependency advisories and local image vulnerability scans; no changes to dependencies/images', checks: [] };
const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
async function run(file, args, cwd = root) {
  try { const r = await exec(file, args, { cwd, timeout: 240000, maxBuffer: 32 * 1024 * 1024, windowsHide: true }); return { code: 0, stdout: r.stdout }; }
  catch (error) { return { code: typeof error.code === 'number' ? error.code : null, stdout: error.stdout || '', stderr: error.stderr || '', reason: typeof error.code === 'string' ? error.code : 'nonzero_exit' }; }
}
function record(row) { report.checks.push(row); save(); console.log(JSON.stringify({ id: row.id, status: row.status, high: row.high, critical: row.critical, reason: row.reason })); }
if (!imagesOnly) await Promise.all([
  ...['root', 'frontend'].map(async name => {
    const cwd = name === 'root' ? root : resolve(root, 'frontend');
    const lock = resolve(cwd, 'package-lock.json');
    const before = createHash('sha256').update(readFileSync(lock)).digest('hex');
    // npm.cmd requires cmd.exe on Windows. Command text contains no user values.
    const cache = name === 'root' ? '.run/audit-20261116/npm-root' : '../.run/audit-20261116/npm-frontend';
    const result = await run('cmd.exe', ['/d', '/s', '/c', `npm.cmd audit --json --package-lock-only --ignore-scripts --cache ${cache}`], cwd);
    try {
      const data = JSON.parse(result.stdout);
      if (!data.metadata?.vulnerabilities || data.error) throw Error('No advisory result');
      const counts = data.metadata.vulnerabilities;
      record({ id: `NPM:${name}`, status: counts.total === 0 && before === createHash('sha256').update(readFileSync(lock)).digest('hex') ? 'PASS' : 'FAIL', exit: result.code, counts, lockfile_unchanged: before === createHash('sha256').update(readFileSync(lock)).digest('hex'), advisories: Object.values(data.vulnerabilities || {}).map(v => ({ package: v.name, severity: v.severity, direct: v.isDirect, affected: v.range, fix_available: v.fixAvailable, via: v.via.map(a => typeof a === 'string' ? { dependency: a } : { title: a.title, url: a.url, severity: a.severity, range: a.range }) })) });
    } catch { record({ id: `NPM:${name}`, status: 'BLOCKED', exit: result.code, reason: 'No valid registry advisory response; raw output withheld' }); }
  }),
  (async () => {
    const tool = resolve(root, '.run/audit-tools/bin/cargo-audit.exe');
    if (!existsSync(tool)) return record({ id: 'RUSTSEC', status: 'BLOCKED', reason: 'Existing cargo-audit tool missing; nothing installed' });
    const result = await run(tool, ['audit', '--file', 'backend-rust/Cargo.lock', '--db', resolve(privateDir, 'rustsec-db'), '--json']);
    try {
      const data = JSON.parse(result.stdout);
      if (!data.vulnerabilities) throw Error('No RustSec result');
      record({ id: 'RUSTSEC', status: data.vulnerabilities.found ? 'FAIL' : 'PASS', exit: result.code, count: data.vulnerabilities.count, advisories: (data.vulnerabilities.list || []).map(v => ({ id: v.advisory.id, package: v.package.name, version: v.package.version, title: v.advisory.title, url: v.advisory.url })), warnings: Object.fromEntries(Object.entries(data.warnings || {}).map(([key, values]) => [key, values.length])), database: data.database });
    } catch { record({ id: 'RUSTSEC', status: 'BLOCKED', exit: result.code, reason: 'No valid advisory result; no dependency change' }); }
  })()
]);
const trivy = resolve(root, '.run/audit-tools/trivy-v0.75.0/trivy.exe');
for (const service of ['backend', 'frontend', 'nginx', 'postgres', 'redis']) {
  if (!existsSync(trivy)) { record({ id: `IMAGE:${service}`, status: 'BLOCKED', reason: 'Existing Trivy missing; nothing installed' }); continue; }
  const metadata = await run('docker', ['inspect', `uasspain-${service}`, '--format', '{{.Config.Image}}']);
  const image = metadata.stdout.trim();
  if (metadata.code !== 0 || !image) { record({ id: `IMAGE:${service}`, status: 'BLOCKED', reason: 'Container image reference unavailable' }); continue; }
  const raw = resolve(privateDir, `trivy-${phase}-${service}.json`);
  const result = await run(trivy, ['image', '--image-src', 'docker', '--scanners', 'vuln', '--severity', 'HIGH,CRITICAL', '--format', 'json', '--output', raw, '--cache-dir', resolve(privateDir, 'trivy-cache'), '--timeout', '3m', '--no-progress', image]);
  try {
    if (result.code !== 0 || !existsSync(raw)) throw Error('No scan');
    const data = JSON.parse(readFileSync(raw, 'utf8'));
    const findings = (data.Results || []).flatMap(r => r.Vulnerabilities || []);
    const high = findings.filter(v => v.Severity === 'HIGH').length;
    const critical = findings.filter(v => v.Severity === 'CRITICAL').length;
    const dbResult = await run(trivy, ['--cache-dir', resolve(privateDir, 'trivy-cache'), '--version', '--format', 'json']);
    let database; try { database = JSON.parse(dbResult.stdout).VulnerabilityDB; } catch {}
    const inspected = await run('docker', ['image', 'inspect', image, '--format', '{{.Id}}']);
    record({ id: `IMAGE:${service}`, status: findings.length ? 'FAIL' : 'PASS', image, resolved_image: inspected.stdout.trim(), scanner_image_id: data.Metadata?.ImageID, high, critical, database, advisories: findings.map(v => ({ id: v.VulnerabilityID, package: v.PkgName, installed: v.InstalledVersion, fixed: v.FixedVersion, severity: v.Severity, url: v.PrimaryURL })) });
  } catch { record({ id: `IMAGE:${service}`, status: 'BLOCKED', exit: result.code, reason: 'Local image or advisory database scan unavailable; no image pulled or changed' }); }
}
for (const path of ['scripts/audit', 'docs/audits']) {
  const tool = resolve(root, '.run/audit-tools/gitleaks-v8.30.1/gitleaks.exe');
  const result = await run(tool, ['dir', path, '--config', '.gitleaks.toml', '--redact', '--no-banner', '--no-color']);
  record({ id: `SECRETS:${path}`, status: result.code === 0 ? 'PASS' : result.code === 1 ? 'FAIL' : 'BLOCKED', exit: result.code, scope: 'Directory scan only; no Git history claim; output redacted and withheld' });
}
report.completed_at = new Date().toISOString();
report.status = report.checks.every(x => x.status === 'PASS') ? 'PASS' : 'BLOCKED';
save();
if (report.status !== 'PASS') process.exitCode = 1;
