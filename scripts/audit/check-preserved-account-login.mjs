import https from 'node:https';
import { rootCertificates, checkServerIdentity } from 'node:tls';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const domain = 'uasspain-prueba.duckdns.org';
const report = { observed_at: new Date().toISOString(), scope: 'Seven preserved accounts; real password authentication via original Nginx using public SNI over server LAN, not an independent Internet test', credentials_source: 'Existing owner-protected DPAPI store; memory only', credentials_saved_or_printed: false, credential_changes: 0, accounts: [] };
const sql = query => execFileSync('docker', ['exec', 'uasspain-postgres', 'psql', '-X', '-U', 'uasspain', '-d', 'uasspain', '-qtA', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
const fingerprint = () => sql("SELECT md5(string_agg(row_to_json(p)::text || u.password || u.is_active::text, '' ORDER BY p.id)) FROM accounts_userprofile p JOIN auth_user u ON u.id=p.user_id");
function request(path, actor, body) {
  return new Promise((resolve, reject) => {
    const bytes = body ? JSON.stringify(body) : null;
    const req = https.request({ hostname: '192.168.1.34', servername: domain, path, method: bytes ? 'POST' : 'GET', ca: rootCertificates, rejectUnauthorized: true, checkServerIdentity: (_name, cert) => checkServerIdentity(domain, cert), headers: { Host: domain, Origin: `https://${domain}`, 'X-UASSpain-Window-Id': actor.window, ...(actor.cookies.size ? { Cookie: [...actor.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}), ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) } : {}) } }, res => {
      const chunks = [];
      const authorized = res.socket.authorized;
      for (const value of res.headers['set-cookie'] ?? []) {
        const pair = value.split(';')[0]; const pos = pair.indexOf('=');
        actor.cookies.set(pair.slice(0, pos), pair.slice(pos + 1));
      }
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { data = null; }
        resolve({ status: res.statusCode, authorized, data });
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error('TIMEOUT')));
    req.on('error', reject);
    if (bytes) req.write(bytes);
    req.end();
  });
}
const before = fingerprint();
let accounts;
try {
  accounts = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-File', '.run/backend-audit-20261023/load-authorized-accounts.ps1'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }));
} catch {
  throw new Error('Protected account loader failed; sensitive child output withheld');
}
try {
  for (const account of accounts) {
    const actor = { window: randomUUID(), cookies: new Map() };
    const result = { email: account.email, expected_role: account.role };
    report.accounts.push(result);
    const context = await request('/api/auth/context/', actor, {});
    result.context_http = context.status;
    if (context.status !== 200) { result.status = 'BLOCKED_CONTEXT'; continue; }
    const login = await request('/api/auth/login/', actor, { email: account.email, password: account.password });
    result.login_http = login.status;
    result.login_code = login.data?.code ?? null;
    result.tls_verified = login.authorized;
    if (login.status !== 200) { result.status = login.status === 401 ? 'FAIL_AUTHENTICATION' : 'BLOCKED_LOGIN'; continue; }
    const me = await request('/api/auth/me/', actor);
    result.identity_http = me.status;
    result.identity_matches = me.data?.email?.toLowerCase() === account.email.toLowerCase();
    result.role_matches = (me.data?.session_role ?? me.data?.role ?? me.data?.rol) === account.role;
    result.status = me.status === 200 && result.identity_matches && result.role_matches ? 'PASS' : 'FAIL_IDENTITY';
    const logout = await request('/api/auth/logout/', actor, {});
    result.own_test_session_logout_http = logout.status;
    actor.cookies.clear();
  }
} finally {
  accounts = undefined;
  report.profiles_and_passwords_unchanged = before === fingerprint();
  report.status = report.profiles_and_passwords_unchanged && report.accounts.length === 7 && report.accounts.every(a => a.status === 'PASS') ? 'PASS_SEVEN_SAVED_CREDENTIALS_API_LOGIN' : 'FAIL_OR_BLOCKED';
  writeFileSync('docs/audits/evidence/2026-11-17-preserved-account-login.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
