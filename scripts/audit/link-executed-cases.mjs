/** Attach executed bounded cases; never infer full endpoint/control coverage. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function parse(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (ch === ',' && !quoted) { row.push(cell); cell = ''; }
    else if (ch === '\n' && !quoted) { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const columns = rows.shift(); return { columns, rows: rows.map(values => Object.fromEntries(columns.map((name, i) => [name, values[i] || '']))) };
}
function csv(rows, columns) { const q = v => '"' + String(v ?? '').replaceAll('"', '""') + '"'; return [columns.map(q).join(','), ...rows.map(row => columns.map(k => q(row[k])).join(','))].join('\n') + '\n'; }
const apiPath = resolve(root, 'docs/audits/2026-11-16-api-actual.csv');
const api = parse(readFileSync(apiPath, 'utf8'));
const suite = JSON.parse(readFileSync(resolve(root, 'docs/audits/evidence/2026-11-16-lab-api.json'), 'utf8'));
const ui = JSON.parse(readFileSync(resolve(root, 'docs/audits/evidence/2026-11-16-lab-browser.json'), 'utf8'));
const cases = [];
for (const check of suite.checks.filter(x => x.status === 'PASS')) {
  const match = /^(COMMON|ADMIN_DENY):([^:]+):(\/api\/.*)$/.exec(check.id);
  if (match) cases.push({ method: 'GET', path: match[3], role: match[2], status: 'PASS', expected_http: check.observed.http, evidence: 'evidence/2026-11-16-lab-api.json#' + check.id, scope: match[1] === 'COMMON' ? 'Authenticated read returns parsed non-null content; not complete field validation' : 'Administrative endpoint denies non-admin role' });
  if (check.id.startsWith('IDENTITY:')) cases.push({ method: 'GET', path: '/api/auth/me/', role: check.id.slice(9), status: 'PASS', expected_http: 200, evidence: 'evidence/2026-11-16-lab-api.json#' + check.id, scope: 'Authenticated identity/role confirmed' });
}
for (const check of ui.checks.filter(x => x.status === 'PASS' && /^BROWSER_(LOGIN|LOGOUT):/.test(x.id))) {
  const [, operation, role] = /^BROWSER_(LOGIN|LOGOUT):(.+)$/.exec(check.id);
  cases.push({ method: 'POST', path: '/api/auth/' + operation.toLowerCase() + '/', role, status: 'PASS', expected_http: operation === 'LOGIN' ? 200 : check.observed.http, evidence: 'evidence/2026-11-16-lab-browser.json#' + check.id, scope: 'Real browser ' + operation.toLowerCase() + '; isolated fixture only' });
}
const delivered = JSON.parse(readFileSync(resolve(root, 'docs/audits/evidence/2026-11-16-external-mail.json'), 'utf8'));
if (delivered.status === 'PASS' && delivered.delivery === 'PASS' && delivered.new_rows === 1 && delivered.message?.attempts === 1) {
  cases.push({ method: 'POST', path: '/api/system/smtp/services/{service}/test/', role: 'admin', status: 'PASS', expected_http: 200, evidence: 'evidence/2026-11-16-external-mail.json', scope: 'ORIGINAL real UI success, one automatic-service SMTP ACCEPTED attempt and recipient-confirmed receipt; raw HTTP status not independently captured, no claim for other senders' });
}
for (const row of api.rows) {
  const matches = cases.filter(c => c.method === row.method && c.path === row.path);
  row.executed_case_count = matches.length;
  row.executed_cases = matches.map(c => `${c.role}:${c.expected_http}:${c.evidence}`).join(';');
  row.execution_scope = matches.length ? 'PASS for explicitly listed bounded cases; lab cases use updated backend/frontend images, external-mail case uses ORIGINAL; not whole endpoint or all role variants' : 'No fresh case linked here; historical cases and unlinked new material/realtime cases remain in their reports';
  if (matches.length) row.fresh_execution = 'PASS';
}
const apiColumns = [...api.columns.filter(c => !['executed_case_count', 'executed_cases', 'execution_scope'].includes(c)), 'executed_case_count', 'executed_cases', 'execution_scope'];
writeFileSync(apiPath, csv(api.rows, apiColumns));
writeFileSync(resolve(root, 'docs/audits/2026-11-16-casos-api-enlazados.csv'), csv(cases, ['method', 'path', 'role', 'status', 'expected_http', 'evidence', 'scope']));
const controlsPath = resolve(root, 'docs/audits/2026-11-16-controles-actuales.csv');
const controls = parse(readFileSync(controlsPath, 'utf8'));
for (const row of controls.rows) {
  if (row.source === 'frontend/src/components/admin/AdminSidebar.tsx' && row.control === 'button') {
    const line = readFileSync(resolve(root, row.source), 'utf8').split('\n')[Number(row.line) - 1];
    // The mapped navigation button is distinguished from the mobile close button.
    if (line.trim() === '<button' && Number(row.line) === 58 && ui.navigation.length === 39 && ui.navigation.every(x => x.status === 'PASS')) {
      row.result = 'PASS'; row.permission = 'Authenticated desktop instances: admin20,instructor11,alumno8; per-endpoint authorization has separate cases';
      row.storage = 'N/A: section selection; no business persistence assertion';
      row.expected = 'Select a section, show its matching title and nonempty pane without new JavaScript errors';
      row.evidence = 'evidence/2026-11-16-lab-browser.json#navigation; one JSX template, 39 tested desktop instances; mobile variants not inferred';
    }
  }
}
writeFileSync(controlsPath, csv(controls.rows, controls.columns));
const old = parse(readFileSync(resolve(root, 'docs/audits/2026-11-10-hallazgos-vigentes.csv'), 'utf8'));
const findings = old.rows.map(row => ({ id: row.id, severity: row.severity, status: row.id === 'F15' ? 'PASS' : row.status, evidence: row.id === 'F15' ? '2026-11-12-f15-ubuntu-live.md#estado-vigente-de-la-continuacion' : row.id === 'F16' ? '2026-11-12-pendientes-tras-oauth.md;evidence/2026-11-16-lab-realtime.json;evidence/2026-11-16-lab-media.json' : '2026-11-10-hallazgos-vigentes.csv#' + row.id, scope: row.id === 'F15' ? 'Later PASS supersedes old BLOCKED only for the single authorized physical Ubuntu; no external redundancy or unattended restart claim; no new probe' : row.id === 'F16' ? 'LOCAL DIAGNOSTIC PASS: actual selected ICE, DTLS, audio/video RTP growth and decoded remote video in updated existing lab; prior audible audio retained. Parent remains BLOCKED for mandatory external-network/NAT/TURN certification; no current WSS-main or WAN media claim' : 'Historical bounded evidence retained, not rerun wholesale or declared equivalent to every current variant' }));
for (const id of ['SEC-20261116-LIBXSLT', 'SEC-20261116-KRB5']) findings.push({ id, severity: 'HIGH', status: 'PASS', evidence: 'evidence/2026-11-16-security-post-update.json;evidence/2026-11-16-readonly-post-update.json#DEPLOYED_PATCHED_PACKAGES', scope: 'Authorized image package repair deployed in ORIGINAL, fixed versions and all five current images scanned; no blanket security certification' });
writeFileSync(resolve(root, 'docs/audits/2026-11-16-hallazgos-conciliados.csv'), csv(findings, ['id', 'severity', 'status', 'evidence', 'scope']));
console.log(JSON.stringify({ linked_cases: cases.length, api_entries_with_bounded_cases: api.rows.filter(x => x.executed_case_count).length, original_findings: old.rows.length, findings_with_new_security_repairs: findings.length, status_counts: findings.reduce((a,x) => ({ ...a, [x.status]: (a[x.status] || 0) + 1 }), {}), exhaustive_coverage: false }));
