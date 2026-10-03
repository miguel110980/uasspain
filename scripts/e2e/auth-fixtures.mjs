import { execFileSync } from 'node:child_process';
import { createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
const compose = resolve(root, 'docker-compose.e2e.yml');
const docker = args => execFileSync('docker', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const backend = docker(['compose', '-f', compose, 'ps', '-q', 'backend-e2e']);
const postgres = docker(['compose', '-f', compose, 'ps', '-q', 'postgres-e2e']);
for (const container of [backend, postgres]) {
  if (!container || docker(['inspect', '--format', '{{index .Config.Labels "com.docker.compose.project"}}', container]) !== 'uasspain-e2e') {
    throw new Error('Authentication fixtures require the isolated uasspain-e2e project');
  }
}
const key = Buffer.from(process.env.E2E_FIELD_ENCRYPTION_KEY || '', 'base64');
if (key.length !== 32) throw new Error('Isolated mailbox key is unavailable');
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const check = (condition, gate) => { if (!condition) throw new Error(gate); };
export const sql = query => docker(['exec', postgres, 'psql', '-U', 'uasspain', '-d', 'test_e2e_uasspain', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query]);
export function uuid(value) {
  check(/^[0-9a-f-]{36}$/.test(value), 'Fixture UUID is invalid');
  return value;
}
export function apiClient(windowId = randomUUID(), cookies = {}) {
  return {
    windowId, cookies,
    async call(path, method = 'GET', payload) {
      const form = payload instanceof URLSearchParams;
      const response = await fetch('http://127.0.0.1:8010' + path, {
        method, headers: {
          Origin: 'http://localhost:8010', 'X-UASSpain-Window-Id': windowId,
          'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json',
          Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '),
        },
        body: payload === undefined ? undefined : form ? payload : JSON.stringify(payload),
      });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0], i = pair.indexOf('=');
        cookies[pair.slice(0, i)] = pair.slice(i + 1);
      }
      const raw = await response.text();
      return { status: response.status, body: response.headers.get('content-type')?.includes('json') && raw ? JSON.parse(raw) : null };
    },
  };
}
export async function adminClient() {
  const client = apiClient();
  check((await client.call('/api/auth/login/', 'POST', { email: 'e2e-admin@test.local', password: process.env.E2E_ADMIN_PASSWORD || 'E2eAdmin_2026!' })).status === 200, 'Fixture administrator login'); // pragma: allowlist secret - isolated fixture
  return client;
}
export function mailFiles() {
  return docker(['exec', backend, 'find', '/app/backups/e2e-mailbox', '-maxdepth', '1', '-type', 'f', '-name', '*.enc']).split('\n').filter(Boolean);
}
export async function readMail(email, before, subject) {
  for (let attempt = 0; attempt < 40; attempt++) {
    for (const path of mailFiles().filter(path => !before.has(path))) {
      check(/^\/app\/backups\/e2e-mailbox\/[0-9a-f-]+\.enc$/.test(path), 'Mailbox fixture path');
      const encrypted = docker(['exec', backend, 'cat', path]);
      check(encrypted.startsWith('v1:'), 'Fixture email must be encrypted');
      const bytes = Buffer.from(encrypted.slice(3), 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(-16));
      const message = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString());
      if (message.to === email && (!subject || message.subject.includes(subject))) return message;
    }
    await sleep(100);
  }
  throw new Error('Expected isolated email was not delivered to the encrypted fixture sink');
}
export async function registerFixture(nombre = 'Auth') {
  const suffix = randomUUID();
  const email = `auth-audit-${suffix}@test.local`;
  const password = `Aa9!${randomBytes(18).toString('hex')}`;
  const before = new Set(mailFiles());
  const response = await apiClient().call('/api/auth/register/', 'POST', {
    email, password, username: `auth-${suffix}`, nombre, apellidos: 'Fixture',
    dni_nie: `AUTH-${suffix}`, fecha_nacimiento: '2000-01-01',
  });
  check(response.status === 201, 'Isolated registration');
  const id = uuid(response.body.id);
  const message = await readMail(email, before);
  const code = message.body.match(/\b\d{6}\b/)?.[0];
  check(Boolean(code), 'Generated registration OTP');
  return { email, password, id, code, userId: response.body.user_id };
}
export function resetPayload(message, password) {
  const link = new URL(message.body.match(/https:\/\/\S+/)?.[0] || 'https://invalid.test');
  check(link.protocol === 'https:' && link.pathname === '/restablecer-contrasena', 'HTTPS recovery link');
  check(link.searchParams.get('token')?.startsWith('r2_'), 'Recovery uses a random token');
  return new URLSearchParams({ uid: link.searchParams.get('uid'), token: link.searchParams.get('token'), password });
}
