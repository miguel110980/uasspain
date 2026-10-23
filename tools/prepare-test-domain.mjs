import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { rootCertificates, createSecureContext } from 'node:tls';
import { resolve4, resolve6 } from 'node:dns/promises';
import { execFileSync } from 'node:child_process';

export function mergeHosts(source, hostname) {
  assert.match(hostname, /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
  const seen = new Set();
  const lines = source.split(/\r?\n/).filter(line => {
    const entry = line.match(/^\s*([^#\s]+)\s+1;\s*$/)?.[1];
    if (!entry) return true;
    if (seen.has(entry.toLowerCase())) return false;
    seen.add(entry.toLowerCase()); return true;
  });
  if (!seen.has(hostname)) lines.push(`${hostname} 1;`);
  return lines.join('\n').trimEnd() + '\n';
}

export function mergeOrigins(current, hostname) {
  const values = [...current.split(',').map(value => value.trim()).filter(Boolean), `https://${hostname}`];
  for (const value of values) { const url = new URL(value); assert.equal(value, url.origin, 'Only exact origins are allowed'); assert(['http:', 'https:'].includes(url.protocol)); }
  return [...new Set(values)].join(',');
}

export function renderNginx(source, hostname) {
  assert.match(hostname, /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
  const cert = 'ssl_certificate /run/secrets/edge_tls_cert;';
  const key = 'ssl_certificate_key /run/secrets/edge_tls_key;';
  assert.equal(source.split(cert).length, 2, 'Expected one existing edge certificate');
  assert.equal(source.split(key).length, 2, 'Expected one existing edge key');
  const anchor = '    map $host $allowed_host {';
  assert.equal(source.split(anchor).length, 2);
  const maps = `    # Public test-domain certificate only for its SNI; preserve local TLS.\n    map $ssl_server_name $test_edge_cert {\n        default /run/secrets/edge_tls_cert;\n        ${hostname} /run/secrets/test_domain_tls_cert;\n    }\n    map $ssl_server_name $test_edge_key {\n        default /run/secrets/edge_tls_key;\n        ${hostname} /run/secrets/test_domain_tls_key;\n    }\n\n`;
  return source.replace(anchor, maps + anchor).replace(cert, 'ssl_certificate $test_edge_cert;').replace(key, 'ssl_certificate_key $test_edge_key;');
}

export function verifyPublicCertificate(pem, keyBytes, hostname, now = Date.now()) {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
  assert(blocks.length, 'Certificate PEM is missing');
  const chain = blocks.map(block => new X509Certificate(block));
  const leaf = chain[0];
  assert(leaf.checkHost(hostname), 'Certificate does not cover the test hostname');
  assert(!leaf.ca, 'A CA certificate is not a server certificate');
  const valid = cert => Date.parse(cert.validFrom) <= now && now < Date.parse(cert.validTo);
  assert(chain.every(valid), 'Certificate chain is not currently valid');
  if (leaf.keyUsage?.length) assert(leaf.keyUsage.includes('1.3.6.1.5.5.7.3.1'), 'Certificate is not authorised for TLS server authentication');
  assert(leaf.checkPrivateKey(createPrivateKey(keyBytes)), 'Private key does not match the certificate');
  for (let i = 0; i < chain.length - 1; i++) assert(chain[i + 1].ca && chain[i].checkIssued(chain[i + 1]) && chain[i].verify(chain[i + 1].publicKey), 'Invalid intermediate certificate chain');
  const top = chain.at(-1);
  assert(rootCertificates.some(pemRoot => { const root = new X509Certificate(pemRoot); return root.ca && valid(root) && ((top.fingerprint256 === root.fingerprint256) || (top.checkIssued(root) && top.verify(root.publicKey))); }), 'Chain is not trusted by the public Node CA store');
  createSecureContext({ cert: pem, key: keyBytes, minVersion: 'TLSv1.2' });
  return { hostname, issuer: leaf.issuer, validTo: leaf.validTo, publicTrust: true };
}

async function main() {
  const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
  const policy = JSON.parse(readFileSync(resolve(root, 'nginx/test-domain.json'), 'utf8'));
  assert.equal(policy.enabled, false, 'This preparation tool must never activate the domain');
  const args = process.argv.slice(2);
  const value = flag => { const i = args.indexOf(flag); if (i === -1) return undefined; assert(args[i + 1] && !args[i + 1].startsWith('--'), 'Missing ' + flag); return args[i + 1]; };
  const output = resolve(root, value('--output') || '.run/theme-dns-20261023/domain-preparation');
  const rel = relative(resolve(root, '.run'), output);
  assert(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')), 'Output must be a new directory under .run');
  mkdirSync(output, { recursive: true });
  const save = (name, value) => writeFileSync(resolve(output, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  const domain = policy.hostname;
  if (args.includes('--plan')) {
    const configDir = resolve(root, '.secrets/acme-test-domain');
    assert.match(policy.acmeImage, /^certbot\/certbot@sha256:[a-f0-9]{64}$/);
    const workDir = resolve(output, 'acme-work'), logsDir = resolve(output, 'acme-logs');
    const command = ['docker', 'run', '--rm', '-it', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--tmpfs', '/tmp:rw,nosuid,size=64m', '--mount', `type=bind,source=${configDir},target=/etc/letsencrypt`, '--mount', `type=bind,source=${workDir},target=/var/lib/letsencrypt`, '--mount', `type=bind,source=${logsDir},target=/var/log/letsencrypt`, policy.acmeImage, 'certonly', '--manual', '--preferred-challenges', 'dns', '--cert-name', domain, '--domains', domain, '--config-dir', '/etc/letsencrypt', '--work-dir', '/var/lib/letsencrypt', '--logs-dir', '/var/log/letsencrypt', '--server', 'https://acme-v02.api.letsencrypt.org/directory'];
    save('acme-plan.json', { domain, challenge: 'dns-01', expectedIPv4: policy.expectedIPv4, command, commandExecuted: false, imageDownloaded: false, privateConfigDirectory: configDir, workDirectory: workDir, logDirectory: logsDir, requires: ['Explicit authorisation to issue and create the ACME TXT record', 'Control of _acme-challenge.' + domain, 'Create the new config/work/log directories before execution; restrict the private config directory to the Windows user and SYSTEM', 'Docker and the pinned official Certbot image', 'Account email and acceptance of CA terms at issuance'], opensListeningPorts: false, changesRouter: false, automaticRenewal: false, note: 'Manual DNS-01 renewal requires repeating the challenge unless a separately authorised DNS hook is configured.' });
    console.log('ACME_PLAN=PREPARED; METHOD=DNS-01; EXECUTED=false; PORTS_OPENED=0; DNS_WRITES=0');
    return;
  }
  const certificate = value('--fullchain'), keyPath = value('--private-key');
  assert(certificate && keyPath, 'BLOCKED: supply --fullchain and --private-key for a publicly trusted certificate; use --plan to prepare issuance');
  const certPath = resolve(certificate), privateKeyPath = resolve(keyPath);
  assert(certPath !== privateKeyPath);
  const pem = readFileSync(certPath, 'utf8'), bytes = readFileSync(privateKeyPath);
  let certificateCheck;
  try { certificateCheck = verifyPublicCertificate(pem, bytes, domain); } finally { bytes.fill(0); }
  const addresses = await resolve4(domain);
  const ipv6 = await resolve6(domain).catch(error => { if (['ENODATA', 'ENOTFOUND'].includes(error.code)) return []; throw error; });
  const publicIP = (await (await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(15000) })).json()).ip;
  assert(addresses.length === 1 && addresses[0] === policy.expectedIPv4 && publicIP === policy.expectedIPv4, 'DNS, expected address and current public IPv4 must agree');
  assert.equal(ipv6.length, 0, 'Unexpected AAAA records require separate IPv6 validation');
  let config;
  try { config = JSON.parse(execFileSync('docker', ['compose', '-p', 'uasspain', '-f', 'docker-compose.yml', '-f', 'docker-compose.encrypted.yml', 'config', '--format', 'json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); } catch { throw Error('Unable to read effective Compose configuration; output withheld'); }
  const origins = mergeOrigins(config.services.backend.environment.CORS_ALLOWED_ORIGINS || '', domain);
  save('allowed_hosts.conf', mergeHosts(readFileSync(resolve(root, 'nginx/allowed_hosts.conf'), 'utf8'), domain));
  save('nginx.conf', renderNginx(readFileSync(resolve(root, 'nginx/nginx.conf'), 'utf8'), domain));
  // Admit only the hostname covered by the validated public certificate.
  // Other pending aliases remain blocked, including a distinct OAuth origin.
  const pending = readFileSync(resolve(root, 'nginx/tls_pending_hosts.conf'), 'utf8');
  save('tls_pending_hosts.conf', pending.split(/\r?\n/).filter(line => line.trim() !== `${domain} 1;`).join('\n'));
  const bind = (file, target) => ({ type: 'bind', source: resolve(output, file), target, read_only: true });
  save('compose.test-domain.json', { services: {
    nginx: { volumes: [bind('nginx.conf', '/etc/nginx/nginx.conf'), bind('allowed_hosts.conf', '/etc/nginx/allowed_hosts.conf'), bind('tls_pending_hosts.conf', '/etc/nginx/tls_pending_hosts.conf')], secrets: ['test_domain_tls_cert', 'test_domain_tls_key'] },
    backend: { environment: { CORS_ALLOWED_ORIGINS: origins, JWT_COOKIE_SECURE: 'true' }, volumes: [bind('allowed_hosts.conf', '/app/config/allowed_hosts.conf'), bind('tls_pending_hosts.conf', '/app/config/tls_pending_hosts.conf')] },
  }, secrets: { test_domain_tls_cert: { file: certPath }, test_domain_tls_key: { file: privateKeyPath } } });
  save('verification.json', { certificateCheck, addresses, publicIP, ipv6, deploymentExecuted: false, existingCertificatesPreserved: true, portsChanged: false, siteUrlPreserved: true, frontendUrlPreserved: true, corsOrigins: origins });
  console.log('TEST_DOMAIN_PROFILE=PREPARED_NOT_DEPLOYED; CERTIFICATE=PUBLICLY_TRUSTED; EXISTING_TLS=RETAINED; PORTS_CHANGED=false');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(String(error.message).split('\n')[0]); process.exitCode = 1; });
