/** Reuse the authorized existing synthetic lab; never recreate its database. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const lab = resolve(root, '.run/closure-20261109-630870e0');
const manifest = JSON.parse(readFileSync(resolve(lab, 'api-lab-manifest.json'), 'utf8'));
assert.equal(manifest.project, 'uasspain-mail-audit-closure-630870e0');
assert.equal(manifest.owner, 'closure-20261109-630870e0');
function run(file, args, env = {}) {
  const r = spawnSync(file, args, { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0 || r.error) {
    const reason = /password authentication failed/.test(r.stderr || '') ? 'authentication_failed' : /does not exist/.test(r.stderr || '') ? 'fixture_object_missing' : 'operation_failed';
    throw Error(`${file} ${reason} (${r.status ?? 'unavailable'}); private output withheld`);
  }
  return r.stdout.trim();
}
const docker = args => run('docker', args);
const expected = ['backend-e2e', 'web-e2e', 'postgres-e2e'].map(service => `${manifest.project}-${service}-1`);
for (const name of expected.concat(manifest.smtp)) {
  const c = JSON.parse(docker(['inspect', name]))[0];
  assert.equal(c.Config.Labels['uasspain.fixture'], manifest.owner);
  assert.ok(!c.Mounts.some(m => m.Type === 'volume'));
  const normalize = path => path.replaceAll('\\', '/').replace(/\/+/g, '/');
  for (const mount of c.Mounts.filter(m => m.Type === 'bind')) {
    const source = normalize(mount.Source);
    const ownFixture = source.startsWith(normalize(lab) + '/');
    const readonlyInitializer = source === normalize(resolve(root, 'scripts/e2e/backup-roles.sql')) && mount.Destination === '/docker-entrypoint-initdb.d/10-backup-roles.sql' && mount.RW === false;
    assert.ok(ownFixture || readonlyInitializer, 'Unexpected bind outside the identified existing fixture');
  }
}
for (const name of [expected[2], manifest.smtp]) docker(['start', name]);
const postgres = expected[2];
const keyPath = resolve(lab, 'api-lab.dpapi').replaceAll("'", "''");
const loader = `Add-Type -AssemblyName System.Security; $b=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes('${keyPath}'),[Text.Encoding]::UTF8.GetBytes('UASSpain|closure20261109|630870e0'),[Security.Cryptography.DataProtectionScope]::CurrentUser);try{[Console]::Write([Text.Encoding]::UTF8.GetString($b))}finally{[Array]::Clear($b,0,$b.Length)}`;
const env = JSON.parse(run('powershell.exe', ['-NoProfile', '-Command', loader]));
const query = text => run('docker', ['exec', '--env', 'PGPASSWORD', postgres, 'psql', '-X', '-U', 'uasspain', '-d', 'test_e2e_uasspain', '-qtA', '-v', 'ON_ERROR_STOP=1', '-c', text], { PGPASSWORD: env.CLOSURE_DB_PASSWORD });
const observed = query("BEGIN READ ONLY; SELECT current_database(); SELECT count(*) FROM pg_tables WHERE schemaname='public'; COMMIT;").split('\n');
assert.equal(observed[0], 'test_e2e_uasspain');
const emptyEphemeralFixture = observed[1] === '0';
if (!emptyEphemeralFixture) assert.equal(query('BEGIN READ ONLY; SELECT max(version) FROM _sqlx_migrations; COMMIT;'), '34');
const images = [];
for (const service of ['backend', 'frontend']) {
  const current = JSON.parse(docker(['inspect', `uasspain-${service}`]))[0];
  const im = JSON.parse(docker(['image', 'inspect', current.Config.Image]))[0];
  const alias = `uasspain-audit-${service}:validated-20261116`;
  docker(['image', 'tag', im.Id, alias]);
  images.push({ service, alias, image: im.Id });
}
const override = resolve(root, '.run/audit-20261116/lab-images.yml');
writeFileSync(override, `services:\n  backend-e2e:\n    image: ${images[0].alias}\n    ports: !reset []\n  web-e2e:\n    image: ${images[1].alias}\n`);
const args = ['compose', '-p', manifest.project, '-f', resolve(lab, 'compose.api.json'), '-f', override];
const config = JSON.parse(run('docker', [...args, 'config', '--format', 'json'], env));
assert.deepEqual(Object.keys(config.services).sort(), ['backend-e2e', 'postgres-e2e', 'web-e2e']);
assert.ok(!config.services['backend-e2e'].ports?.length);
for (const binding of config.services['web-e2e'].ports || []) assert.equal(binding.host_ip, '127.0.0.1');
const originalDbId = JSON.parse(docker(['inspect', postgres]))[0].Id;
run('docker', [...args, 'up', '-d', '--no-build', '--pull', 'never', '--no-deps', '--wait', '--wait-timeout', '120', 'backend-e2e', 'web-e2e'], env);
assert.equal(JSON.parse(docker(['inspect', postgres]))[0].Id, originalDbId);
assert.equal(query('BEGIN READ ONLY; SELECT max(version) FROM _sqlx_migrations; COMMIT;'), '34');
const result = { observed_at: new Date().toISOString(), project: manifest.project, status: 'PASS', source: 'Exact backend/frontend image indexes from updated ORIGINAL', images, database_container_preserved: true, initially_empty_ephemeral_fixture: emptyEphemeralFixture, database: 'test_e2e_uasspain', production_volumes_mounted: false, ports_loopback_only: true, scope: 'Existing lab HTTP configuration retained; does not certify original TLS, WAN or real media' };
writeFileSync(resolve(root, 'docs/audits/evidence/2026-11-16-existing-lab.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
