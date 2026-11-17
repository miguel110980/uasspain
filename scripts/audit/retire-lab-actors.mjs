/** Block only the three owned synthetic accounts; retain all records. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const origin = 'http://127.0.0.1:18010';
const project = 'uasspain-mail-audit-closure-630870e0';
const output = resolve(root, 'docs/audits/evidence/2026-11-16-lab-retirement.json');
function load(path, entropy) {
  try { return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Security;$b=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes('${path.replaceAll("'", "''")}'),[Text.Encoding]::UTF8.GetBytes('${entropy}'),[Security.Cryptography.DataProtectionScope]::CurrentUser);try{[Console]::Write([Text.Encoding]::UTF8.GetString($b))}finally{[Array]::Clear($b,0,$b.Length)}`], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })); }
  catch { throw Error('Protected fixture unavailable; no credentials included'); }
}
const state = load(resolve(root, '.run/audit-20261116/lab-fixtures.dpapi'), 'UASSpain|audit-20261116|lab-fixtures|v1');
const env = load(resolve(root, '.run/closure-20261109-630870e0/api-lab.dpapi'), 'UASSpain|closure20261109|630870e0');
assert.equal(state.owner, 'audit-20261116'); assert.equal(state.project, project);
assert.equal(state.actors.length, 3);
assert.equal(new Set(state.actors.map(x => x.id)).size, 3);
for (const service of ['backend-e2e', 'postgres-e2e', 'web-e2e']) {
  const c = JSON.parse(execFileSync('docker', ['inspect', `${project}-${service}-1`], { encoding: 'utf8', windowsHide: true }))[0];
  assert.equal(c.Config.Labels['com.docker.compose.project'], project);
  assert.equal(c.Config.Labels['uasspain.fixture'], 'closure-20261109-630870e0');
}
for (const actor of state.actors) {
  assert.match(actor.id, /^[a-f0-9-]{36}$/i);
  assert.equal(actor.apellidos, 'Synthetic'); assert.match(actor.nombre, /^Audit1611 /);
  assert.ok(actor.email.endsWith(`-${state.suffix}@test.local`));
  assert.ok(['alumno', 'instructor'].includes(actor.role));
}
const report = { started_at: new Date().toISOString(), project, status: 'RUNNING', scope: 'Only profiles listed in owned DPAPI fixture, verified against live API before blocking; no deletion, password change or original write', checks: [], profiles: [], deletions: 0, original_writes: 0 };
const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
const gate = (id, ok, observed = {}) => { report.checks.push({ id, status: ok ? 'PASS' : 'FAIL', observed }); save(); assert.ok(ok, id); };
function client() {
  const cookies = new Map(), windowId = randomUUID();
  return { async call(path, method = 'GET', data) {
    assert.ok(path.startsWith('/api/'));
    const r = await fetch(origin + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json', 'X-UASSpain-Window-Id': windowId, Cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; ') }, body: data === undefined ? undefined : JSON.stringify(data) });
    for (const line of r.headers.getSetCookie()) { const p = line.split(';')[0], i = p.indexOf('='); cookies.set(p.slice(0,i), p.slice(i+1)); }
    let body; try { body = await r.json(); } catch { body = null; } return { status: r.status, body };
  } };
}
try {
  const admin = client(); await admin.call('/api/auth/context/', 'POST', {});
  gate('ADMIN_LOGIN', (await admin.call('/api/auth/login/', 'POST', { email: 'e2e-admin@test.local', password: env.CLOSURE_ADMIN_PASSWORD })).status === 200);
  const before = await admin.call('/api/profiles/');
  gate('BEFORE_PROFILE_LIST', before.status === 200 && Array.isArray(before.body));
  const ids = before.body.map(x => x.id).sort();
  // Students first; do not change instructor assignments or shared material grants.
  for (const actor of [...state.actors].sort((a,b) => (a.role === 'instructor') - (b.role === 'instructor'))) {
    const current = await admin.call(`/api/profiles/${actor.id}/`);
    gate(`PROVENANCE:${actor.role}:${actor.index ?? 'teacher'}`, current.status === 200 && current.body.id === actor.id && current.body.email === actor.email && current.body.nombre === actor.nombre && current.body.apellidos === actor.apellidos && current.body.role === actor.role);
    const blocked = await admin.call(`/api/profiles/${actor.id}/`, 'PATCH', { status: 'bloqueado' });
    gate(`BLOCK_SYNTHETIC:${actor.id}`, blocked.status === 200, { http: blocked.status });
    const verified = await admin.call(`/api/profiles/${actor.id}/`);
    gate(`RECORD_RETAINED_AND_BLOCKED:${actor.id}`, verified.status === 200 && verified.body.status === 'bloqueado' && verified.body.role === actor.role);
    const denied = client(); await denied.call('/api/auth/context/', 'POST', {});
    const login = await denied.call('/api/auth/login/', 'POST', { email: actor.email, password: actor.password });
    gate(`NEW_LOGIN_DENIED:${actor.id}`, login.status === 401, { http: login.status });
    report.profiles.push({ id: actor.id, role: actor.role, origin: state.owner, status: 'bloqueado', record_retained: true }); save();
  }
  const after = await admin.call('/api/profiles/');
  gate('ALL_PROFILE_IDS_RETAINED', after.status === 200 && JSON.stringify(after.body.map(x => x.id).sort()) === JSON.stringify(ids), { profiles: ids.length });
  gate('UNOWNED_PROFILES_UNCHANGED', before.body.filter(x => !state.actors.some(a => a.id === x.id)).every(x => JSON.stringify(after.body.find(y => y.id === x.id)) === JSON.stringify(x)));
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.reason = error instanceof assert.AssertionError ? 'Failed gate; see checks' : 'Fixture retirement could not complete; no secrets included'; process.exitCode = 1;
} finally { report.completed_at = new Date().toISOString(); save(); }
console.log(JSON.stringify({ status: report.status, checks: report.checks.length, profiles: report.profiles.length, report: 'docs/audits/evidence/2026-11-16-lab-retirement.json' }));
