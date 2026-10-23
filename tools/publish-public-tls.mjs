import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { X509Certificate } from 'node:crypto';
import { verifyPublicCertificate } from './prepare-test-domain.mjs';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const privateRoot = resolve(root, '.secrets/acme-duckdns-20261023');
const hosts = ['uasspain-prueba.duckdns.org', 'www.uasspain-prueba.duckdns.org'];
const staged = [];
try {
  for (const host of hosts) {
    const archive = resolve(privateRoot, 'config/archive', host);
    const versions = readdirSync(archive).map(name => /^fullchain(\d+)\.pem$/.exec(name)?.[1]).filter(Boolean).map(Number);
    assert(versions.length, 'Certificate archive is empty');
    const version = Math.max(...versions);
    const cert = readFileSync(resolve(archive, `fullchain${version}.pem`), 'utf8');
    const key = readFileSync(resolve(archive, `privkey${version}.pem`));
    staged.push({ host, cert, key });
    verifyPublicCertificate(cert, key, host);
    assert(Date.parse(new X509Certificate(cert).validTo) - Date.now() > 7 * 86400000, 'Certificate expires too soon');
  }
  // Validate both certificates and their keys before publishing either pair.
  const destination = resolve(privateRoot, 'deployed');
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const { host, cert, key } of staged) {
    for (const [suffix, bytes] of [['fullchain.pem', cert], ['privkey.pem', key]]) {
      const target = resolve(destination, `${host}.${suffix}`);
      const temporary = target + '.new';
      writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, target);
    }
  }
  console.log(JSON.stringify({ result: 'PUBLIC_CERTIFICATES_PUBLISHED', certificates: staged.map(({ host, cert }) => { const c = new X509Certificate(cert); return { host, issuer: c.issuer, validFrom: c.validFrom, validTo: c.validTo, san: c.subjectAltName, fingerprint: c.fingerprint256 }; }), secretsPrinted: false }));
} catch {
  console.error('PUBLIC_TLS_PUBLISH=BLOCKED; certificate/key validation or file operation failed; sensitive details suppressed');
  process.exitCode = 1;
} finally {
  for (const item of staged) item.key.fill(0);
}
