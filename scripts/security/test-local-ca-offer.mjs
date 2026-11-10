// Read-only checks for the browser's explicit local CA enrolment response.
import assert from 'node:assert/strict';
import https from 'node:https';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { X509Certificate, createHash } from 'node:crypto';

const ca = await readFile(new URL('../../.secrets/tls/ca.crt', import.meta.url));
const expected = new X509Certificate(ca);
const container = process.argv[2];
if (container && !/^uasspain-ca-offer-preflight-[a-f0-9]+$/.test(container)) throw Error('Unexpected preflight container');
const results = [];
async function request(path, method = 'GET', host = 'localhost') {
  if (container) {
    const args = ['exec', container, 'curl', '--silent', '--show-error', '--max-time', '10', '--path-as-is', '--cacert', '/run/secrets/backend_tls_ca', '--include', '--header', 'Host: ' + host];
    args.push(...(method === 'HEAD' ? ['--head'] : ['--request', method]), 'https://localhost:8443' + path);
    const run = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true });
    if (run.status !== 0) throw Error('Preflight transport failed: ' + run.status);
    const split = run.stdout.indexOf('\r\n\r\n');
    const lines = run.stdout.slice(0, split).split('\r\n');
    return { status: Number(lines[0].split(' ')[1]), headers: Object.fromEntries(lines.slice(1).map(line => { const i = line.indexOf(':'); return [line.slice(0, i).toLowerCase(), line.slice(i + 1).trim()]; })), body: Buffer.from(run.stdout.slice(split + 4)) };
  }
  return new Promise((resolve, reject) => {
    const req = https.request('https://localhost' + path, { method, ca, rejectUnauthorized: true, headers: { Host: host }, timeout: 10000 }, res => {
      const chunks = []; res.on('data', data => chunks.push(data));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(Error('Timeout'))); req.end();
  });
}
async function check(name, run) {
  try { await run(); results.push({ name, status: 'PASS' }); }
  catch (error) { results.push({ name, status: 'FAIL', reason: error.message }); }
}
const response = await request('/instalar-certificado.crt');
await check('GET returns the existing public CA, with no private key or extra certificate', () => {
  assert.equal(response.status, 200);
  assert.equal(response.body.toString().match(/-----BEGIN CERTIFICATE-----/g)?.length, 1);
  assert.doesNotMatch(response.body.toString(), /PRIVATE KEY/);
  assert.equal(createHash('sha256').update(response.body).digest('hex'), createHash('sha256').update(ca).digest('hex'));
  const downloaded = new X509Certificate(response.body);
  assert.equal(downloaded.fingerprint256, expected.fingerprint256); assert.equal(downloaded.ca, true);
});
for (const [key, value] of Object.entries({ 'content-type': 'application/x-x509-ca-cert', 'content-disposition': 'inline; filename="UASSpain-Local-CA.crt"', 'cache-control': 'no-store', 'cross-origin-resource-policy': 'same-origin', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'strict-transport-security': 'max-age=31536000; includeSubDomains; preload' })) {
  await check('Header ' + key, () => assert.equal(response.headers[key], value));
}
await check('HEAD retains the certificate MIME type and has no body', async () => {
  const r = await request('/instalar-certificado.crt', 'HEAD'); assert.equal(r.status, 200); assert.equal(r.body.length, 0); assert.equal(r.headers['content-type'], 'application/x-x509-ca-cert');
});
await check('POST cannot change or enrol anything on the server', async () => assert.equal((await request('/instalar-certificado.crt', 'POST')).status, 403));
await check('The enrolment endpoint is unavailable under other allowed hostnames', async () => assert.equal((await request('/instalar-certificado.crt', 'GET', '127.0.0.1')).status, 404));
for (const path of ['/.secrets/tls/ca.key', '/ca.key', '/instalar-certificado.crt/../ca.key']) {
  await check('Private path remains denied: ' + path, async () => assert.equal((await request(path)).status, 404));
}
await check('Application readiness remains available', async () => assert.equal((await request('/readyz')).status, 200));
const report = { at: new Date().toISOString(), scope: container ? 'temporary original-config preflight, no public ports' : 'ORIGINAL deployed Nginx HTTPS with explicit CA validation', container: container || null, browser_installation: 'NOT_TESTED', fingerprint256: expected.fingerprint256, results };
const folder = new URL('../../.run/certificate-trust-20261110/', import.meta.url);
await mkdir(folder, { recursive: true });
await writeFile(new URL(container ? 'preflight-tests.json' : 'deployed-tests.json', folder), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ scope: report.scope, pass: results.filter(r => r.status === 'PASS').length, fail: results.filter(r => r.status !== 'PASS') }));
if (results.some(r => r.status !== 'PASS')) process.exitCode = 1;
