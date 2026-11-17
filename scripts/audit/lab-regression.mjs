/** Positive/negative API regression on the existing synthetic lab only. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const privateDir = resolve(root, '.run/audit-20261116');
const origin = 'http://127.0.0.1:18010';
const project = 'uasspain-mail-audit-closure-630870e0';
const output = resolve(root, 'docs/audits/evidence/2026-11-16-lab-api.json');
const actorsFile = resolve(privateDir, 'lab-fixtures.dpapi');
const report = { started_at: new Date().toISOString(), scope: 'Existing synthetic lab; exact updated ORIGINAL backend/frontend images; HTTP loopback does not certify original TLS or external delivery/media', checks: [], status: 'RUNNING', business_deletions: 0, original_business_writes: 0 };
const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
function run(file, args, input) {
  const r = spawnSync(file, args, { cwd: root, input, encoding: 'utf8', timeout: 30000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0 || r.error) throw Error('Private fixture operation failed; output withheld');
  return r.stdout.trim();
}
function unprotect(file, entropy) {
  return JSON.parse(run('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Security;$b=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes('${file.replaceAll("'", "''")}'),[Text.Encoding]::UTF8.GetBytes('${entropy}'),[Security.Cryptography.DataProtectionScope]::CurrentUser);try{[Console]::Write([Text.Encoding]::UTF8.GetString($b))}finally{[Array]::Clear($b,0,$b.Length)}`]));
}
const env = unprotect(resolve(root, '.run/closure-20261109-630870e0/api-lab.dpapi'), 'UASSpain|closure20261109|630870e0');
const manifest = JSON.parse(readFileSync(resolve(root, '.run/closure-20261109-630870e0/api-lab-manifest.json'), 'utf8'));
assert.equal(manifest.project, project);
const identity = JSON.parse(readFileSync(resolve(root, 'docs/audits/evidence/2026-11-16-existing-lab.json'), 'utf8'));
assert.equal(identity.status, 'PASS');
for (const service of ['backend-e2e', 'web-e2e', 'postgres-e2e']) {
  const c = JSON.parse(run('docker', ['inspect', `${project}-${service}-1`]))[0];
  assert.equal(c.Config.Labels['com.docker.compose.project'], project);
  assert.equal(c.Config.Labels['uasspain.fixture'], manifest.owner);
}
const state = existsSync(actorsFile) ? unprotect(actorsFile, 'UASSpain|audit-20261116|lab-fixtures|v1') : { owner: 'audit-20261116', suffix: randomBytes(5).toString('hex'), project, actors: [] };
assert.equal(state.owner, 'audit-20261116'); assert.equal(state.project, project);
function persist() {
  run('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Security;$b=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd());try{$p=[Security.Cryptography.ProtectedData]::Protect($b,[Text.Encoding]::UTF8.GetBytes('UASSpain|audit-20261116|lab-fixtures|v1'),[Security.Cryptography.DataProtectionScope]::CurrentUser);[IO.File]::WriteAllBytes('${actorsFile.replaceAll("'", "''")}', $p)}finally{[Array]::Clear($b,0,$b.Length)}`], JSON.stringify(state));
}
const gate = (id, condition, observed = {}) => { report.checks.push({ id, status: condition ? 'PASS' : 'FAIL', observed }); save(); assert.ok(condition, id); };
function client() {
  const jar = new Map(); const windowId = randomUUID();
  return { windowId, async call(path, method = 'GET', data) {
    assert.ok(path.startsWith('/api/'));
    const response = await fetch(origin + path, { method, headers: { Origin: origin, 'X-UASSpain-Window-Id': windowId, 'Content-Type': 'application/json', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: data === undefined ? undefined : JSON.stringify(data) });
    for (const line of response.headers.getSetCookie()) { const pair = line.split(';')[0], at = pair.indexOf('='); jar.set(pair.slice(0, at), pair.slice(at + 1)); }
    const text = await response.text(); let body; try { body = JSON.parse(text); } catch { body = null; }
    if (response.status >= 400) {
      const detail = body?.detail ?? body?.error ?? body?.message;
      let safe = typeof detail === 'string' ? detail : 'No public detail';
      for (const actor of state.actors) if (actor.password) safe = safe.replaceAll(actor.password, '[REDACTED]');
      report.last_error = { path: path.split('?')[0], method, status: response.status, detail: safe.slice(0, 200) };
    }
    return { status: response.status, body };
  } };
}
async function login(account) {
  const actor = client(); await actor.call('/api/auth/context/', 'POST', {});
  const response = await actor.call('/api/auth/login/', 'POST', { email: account.email, password: account.password });
  gate(`LOGIN:${account.role}`, response.status === 200, { http: response.status });
  return actor;
}
function messages() { return JSON.parse(run('docker', ['exec', manifest.smtp, 'node', '-e', "fetch('http://127.0.0.1:2527/messages').then(r=>r.text()).then(t=>process.stdout.write(t))"])); }
async function otpFor(email) {
  for (let i = 0; i < 80; i++) {
    const mail = messages().find(m => m.to.includes(email));
    if (mail) { const otp = (mail.body || mail.raw || '').match(/\b\d{6}\b/)?.[0]; if (otp) { gate('SMTP_OTP_ENCRYPTED_TRANSPORT', mail.tls === true); return otp; } }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw Error('Isolated SMTP OTP not observed');
}
try {
  const admin = await login({ role: 'admin', email: 'e2e-admin@test.local', password: env.CLOSURE_ADMIN_PASSWORD });
  // Configure only the existing non-forwarding SMTP fixture, using actual
  // authenticated STARTTLS acceptance; never seed verification records in SQL.
  run('docker', ['exec', manifest.smtp, 'node', '-e', "fetch('http://127.0.0.1:2527/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({allow_auto:true,mode:'accept'})}).then(r=>{if(!r.ok)process.exitCode=1})"]);
  for (const service of ['contact', 'automatic']) {
    const path = `/api/system/smtp/services/${service}/`;
    const current = await admin.call(path);
    if (current.body?.active_ready === true) continue;
    if (current.body?.verification_status === 'UNKNOWN') {
      const before = messages().length;
      const refused = await admin.call(path + 'test/', 'POST', { revision: current.body.revision, request_id: randomUUID(), recipient: 'smtp-audit-20261116@test.local', confirm_authorized_recipient: true });
      gate(`SMTP_UNKNOWN_PREVENTS_DUPLICATE:${service}`, refused.status === 400 && messages().length === before, { http: refused.status });
      report.checks.push({ id: `SMTP_LAB_READY:${service}`, status: 'BLOCKED', reason: 'Earlier expired-fixture TLS attempt remains UNKNOWN; no SQL reconciliation, duplicate send or unrelated revision change performed' }); save();
      continue;
    }
    const automatic = service === 'automatic';
    const configured = await admin.call(path, 'PUT', { settings: { enabled: true, shared_transport: false, authorized_sender: true, independent_auth_required: true, config: { enabled: true, provider: 'isolated-fixture', host: 'mail-dual-fixture', port: automatic ? 2526 : 2525, security: 'STARTTLS', username: automatic ? 'automatic-fixture' : 'shared-fixture', from_email: automatic ? 'no-reply@uasspain.com' : 'info@uasspain.com', from_name: 'UASSpain', contact_recipient: 'info@uasspain.com', timeout_seconds: 5 } }, password: automatic ? env.SMTP_DUAL_AUTOMATIC_PASSWORD : env.SMTP_DUAL_SHARED_PASSWORD });
    gate(`SMTP_LAB_CONFIG:${service}`, configured.status === 200, { http: configured.status });
    const sent = await admin.call(path + 'test/', 'POST', { revision: configured.body.revision, request_id: randomUUID(), recipient: 'smtp-audit-20261116@test.local', confirm_authorized_recipient: true });
    gate(`SMTP_LAB_ACCEPTED:${service}`, sent.status === 200 && sent.body.state === 'ACCEPTED', { http: sent.status, real_external_delivery: 'NOT_RUN' });
    const ready = await admin.call(path); gate(`SMTP_LAB_READY:${service}`, ready.body.active_ready === true);
  }
  let teacher = state.actors.find(x => x.role === 'instructor');
  if (!teacher) {
    teacher = { role: 'instructor', email: `audit-t-${state.suffix}@test.local`, password: 'Aa9!' + randomBytes(18).toString('hex'), nombre: 'Audit1611 Instructor', apellidos: 'Synthetic', username: `audit-t-${state.suffix}` };
    const created = await admin.call('/api/users/crear-instructor/', 'POST', teacher);
    gate('CREATE_SYNTHETIC_INSTRUCTOR', created.status === 201, { http: created.status });
    teacher.id = created.body.id; state.actors.push(teacher); persist();
  }
  const instructor = await login(teacher);
  for (let index = 0; index < 2; index++) {
    let student = state.actors.find(x => x.role === 'alumno' && x.index === index);
    if (!student) {
      student = { role: 'alumno', index, email: `audit-s${index}-${state.suffix}@test.local`, password: 'Aa9!' + randomBytes(18).toString('hex'), nombre: `Audit1611 Alumno ${index + 1}`, apellidos: 'Synthetic', username: `audit-s${index}-${state.suffix}` };
      state.actors.push(student); persist();
    }
    if (!student.id) {
      const created = await client().call('/api/auth/register/', 'POST', student);
      gate(`REGISTER:${index}`, created.status === 201, { http: created.status });
      student.id = created.body.id; persist();
    }
    if (!student.verified) {
      const code = await otpFor(student.email);
      const verified = await client().call('/api/auth/verify-otp/', 'POST', { email: student.email, code });
      gate(`SMTP_OTP_VERIFY:${index}`, verified.status === 200, { http: verified.status, delivery: 'Non-forwarding isolated SMTP receiver; not corporate delivery' });
      student.verified = true; persist();
    }
    if (!student.approved) {
      const pending = await client().call('/api/auth/login/', 'POST', { email: student.email, password: student.password });
      gate(`PENDING_LOGIN_DENIED:${index}`, pending.status === 401, { http: pending.status, contract: 'auth.rs rejects non-active password login with generic Unauthorized before creating a session' });
      const requests = await instructor.call('/api/registration-requests/');
      gate(`INSTRUCTOR_SEES_REQUEST:${index}`, requests.status === 200 && requests.body.some(x => x.id === student.id));
      const approved = await instructor.call(`/api/registration-requests/${student.id}/resolve/`, 'POST', { decision: 'approve' });
      gate(`INSTRUCTOR_APPROVES:${index}`, approved.status === 200, { http: approved.status });
      student.approved = true; persist();
    }
  }
  const students = state.actors.filter(x => x.role === 'alumno').sort((a, b) => a.index - b.index);
  if (!state.assigned) {
    const assigned = await admin.call(`/api/profiles/${teacher.id}/assign-alumnos/`, 'POST', { student_ids: [students[0].id] });
    gate('ASSIGN_ONLY_OWN_SYNTHETIC_STUDENT', assigned.status === 200, { http: assigned.status });
    state.assigned = true; persist();
  }
  const studentClients = []; for (const student of students) studentClients.push(await login(student));
  const roles = [['admin', admin], ['instructor', instructor], ['alumno', studentClients[0]], ['other_alumno', studentClients[1]]];
  for (const [role, actor] of roles) {
    const me = await actor.call('/api/auth/me/');
    gate(`IDENTITY:${role}`, me.status === 200 && (me.body.role === (role === 'other_alumno' ? 'alumno' : role) || me.body.session_role === role));
    for (const path of ['/api/dashboard/counts/', '/api/examenes/', '/api/resultados-examen/', '/api/resultados-practico/', '/api/materiales/', '/api/materiales-completados/', '/api/conexiones/', '/api/videollamadas/']) {
      const r = await actor.call(path); gate(`COMMON:${role}:${path}`, r.status === 200 && r.body !== null, { http: r.status });
    }
    if (role !== 'admin') for (const path of ['/api/system/auth-policy/', '/api/system/smtp/', '/api/system/google-oauth/', '/api/backups/status/', '/api/backups/history/', '/api/backups/config/']) {
      const r = await actor.call(path); gate(`ADMIN_DENY:${role}:${path}`, r.status === 403, { http: r.status });
    }
  }
  const foreign = await studentClients[1].call('/api/mensajes/?alumno_id=' + students[0].id);
  gate('CHAT_OTHER_STUDENT_IDOR_DENIED', foreign.status === 403, { http: foreign.status });
  process.env.E2E_COMPOSE_PROJECT = project; process.env.E2E_API_BASE = origin;
  process.env.E2E_FIELD_ENCRYPTION_KEY = env.CLOSURE_KEY; process.env.E2E_ADMIN_PASSWORD = env.CLOSURE_ADMIN_PASSWORD;
  process.env.E2E_MATERIALS_ACTORS = JSON.stringify([teacher, ...students]);
  process.env.E2E_MATERIALS_DOCUMENTS = readFileSync(resolve(root, '.run/materiales-20261110/documents.json'), 'utf8');
  const materialOutput = resolve(privateDir, 'materials-regression.json'); process.env.E2E_MATERIALS_REPORT = materialOutput;
  await import('../e2e/e2e-material-catalog.mjs');
  const materials = JSON.parse(readFileSync(materialOutput, 'utf8'));
  gate('MATERIALS_INTEGRATION_SUITE', materials.status === 'PASS', { cases: materials.checks.length, failed: materials.checks.filter(x => x.status === 'FAIL').map(x => x.id) });
  state.material_resources = materials.resources; persist();
  report.synthetic_accounts = state.actors.map(x => ({ id: x.id, role: x.role, origin: state.owner }));
  report.materials = { status: materials.status, checks: materials.checks, resources: materials.resources, scope: materials.scope };
  report.status = report.checks.every(x => x.status === 'PASS') ? 'PASS' : 'BLOCKED';
} catch (error) {
  report.status = 'FAIL'; report.reason = error instanceof assert.AssertionError ? 'Gate failed; see failed case' : error.message.slice(0,160); process.exitCode = 1;
} finally { report.completed_at = new Date().toISOString(); save(); }
console.log(JSON.stringify({ report: 'docs/audits/evidence/2026-11-16-lab-api.json', status: report.status, checks: report.checks.length, failures: report.checks.filter(x => x.status === 'FAIL').map(x => x.id), reason: report.reason || null }));
// A blocked mandatory dependency must also fail a command-line release gate.
if (report.status !== 'PASS') process.exitCode = 1;
