/** Authorized local safety backup/recovery. No production restore or remote I/O. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const suffix = randomBytes(6).toString('hex');
const privateRoot = resolve(root, `.run/audit-20261116/preupdate-${suffix}`);
const publicOutput = resolve(root, 'docs/audits/evidence/2026-11-16-preupdate-backup.json');
mkdirSync(privateRoot, { recursive: true });
const report = { started_at: new Date().toISOString(), scope: 'Authorized encrypted local safety backup and isolated DB recovery on the existing encrypted PostgreSQL; no remote destination, active DB restore or deletion', phase: 'preflight', status: 'RUNNING' };
const save = () => writeFileSync(publicOutput, JSON.stringify(report, null, 2) + '\n');
const sha = data => createHash('sha256').update(data).digest('hex');
function docker(args, input, timeout = 60000) {
  const r = spawnSync('docker', args, { cwd: root, input, timeout, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0 || r.error) throw Error(`Docker ${args[0]} failed (${r.status ?? 'unavailable'}); sensitive output withheld`);
  return r.stdout;
}
function sql(query, database = 'uasspain') {
  assert.match(database, /^uasspain(?:_audit_restore_[a-f0-9]{12})?$/);
  return docker(['exec', '-i', 'uasspain-postgres', 'psql', '-X', '-U', 'uasspain', '-d', database, '-qtA', '-v', 'ON_ERROR_STOP=1', '-f', '-'], query).toString().trim();
}
function fingerprint(database = 'uasspain') {
  const tables = JSON.parse(sql("BEGIN READ ONLY; SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public'; COMMIT;", database));
  return tables.map(name => {
    assert.match(name, /^[a-z0-9_]+$/);
    const data = sql(`BEGIN READ ONLY; SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public."${name}" t; COMMIT;`, database);
    return { name, rows: JSON.parse(data).length, sha256: sha(data) };
  });
}
let backendStopped = false;
let key, master, dump, media;
try {
  for (const service of ['nginx', 'frontend', 'backend', 'postgres', 'redis']) {
    const c = JSON.parse(docker(['inspect', `uasspain-${service}`]))[0];
    assert.equal(c.Config.Labels['com.docker.compose.project'], 'uasspain');
    assert.equal(c.State.Health.Status, 'healthy');
  }
  assert.equal(docker(['exec', 'uasspain-postgres', 'findmnt', '-n', '-o', 'FSTYPE', '--mountpoint', '/var/lib/postgresql/data']).toString().trim(), 'fuse.gocryptfs');
  report.phase = 'rollback_images'; save();
  const images = [];
  for (const service of ['nginx', 'frontend', 'backend', 'postgres', 'redis']) {
    const c = JSON.parse(docker(['inspect', `uasspain-${service}`]))[0];
    const im = JSON.parse(docker(['image', 'inspect', c.Config.Image]))[0];
    const platform = JSON.parse(docker(['image', 'inspect', '--platform', 'linux/amd64', c.Config.Image]))[0];
    assert.equal(platform.Descriptor.digest, c.ImageManifestDescriptor.digest, 'Rollback tag differs from the running platform manifest');
    const alias = `uasspain-rollback-${service}:audit20261116-${suffix}`;
    // Tags preserve existing immutable image content; no filesystem snapshot.
    docker(['image', 'tag', im.Id, alias]);
    assert.equal(JSON.parse(docker(['image', 'inspect', alias]))[0].Id, im.Id);
    images.push({ service, container_image: c.Image, resolved_image: im.Id, platform_manifest: platform.Descriptor.digest, matches_running_platform: true, rollback_alias: alias, original_container_id: c.Id });
  }
  report.rollback_images = images;
  writeFileSync(resolve(privateRoot, 'rollback-images.json'), JSON.stringify(images, null, 2) + '\n', { flag: 'wx' });
  report.phase = 'quiesce_backend'; save();
  docker(['stop', '--time', '30', 'uasspain-backend']); backendStopped = true;
  report.phase = 'snapshot'; save();
  const before = fingerprint();
  const dpapi = sha(readFileSync(resolve(root, '.secrets/postgres-storage-key.dpapi')));
  assert.equal(before.find(x => x.name === 'accounts_userprofile').rows, 8);
  writeFileSync(resolve(privateRoot, 'source-fingerprints.json'), JSON.stringify({ tables: before, dpapi_sha256: dpapi }, null, 2) + '\n', { flag: 'wx' });
  master = Buffer.from(readFileSync(resolve(root, '.secrets/field_encryption_key'), 'utf8').trim(), 'base64url');
  assert.equal(master.length, 32);
  key = createHash('sha256').update(master).update('|uasspain|backup-encryption|v2').digest();
  function encryptedArtifact(name, plain) {
    const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const encrypted = Buffer.concat([nonce, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    const destination = resolve(privateRoot, `${name}.enc`);
    assert.ok(!existsSync(destination));
    writeFileSync(destination, encrypted, { mode: 0o600, flag: 'wx' });
    const saved = readFileSync(destination);
    const decipher = createDecipheriv('aes-256-gcm', key, saved.subarray(0, 12)); decipher.setAuthTag(saved.subarray(-16));
    const recovered = Buffer.concat([decipher.update(saved.subarray(12, -16)), decipher.final()]);
    assert.equal(sha(recovered), sha(plain));
    recovered.fill(0);
    return { file: `${name}.enc`, format: 'AES-256-GCM backup v2 domain', encrypted_sha256: sha(saved), plain_sha256: sha(plain), encrypted_bytes: saved.length, authenticated_roundtrip: true };
  }
  dump = docker(['exec', 'uasspain-postgres', 'pg_dump', '-U', 'uasspain', '-d', 'uasspain', '--format=custom'], undefined, 120000);
  assert.equal(dump.subarray(0, 5).toString(), 'PGDMP');
  report.database_backup = encryptedArtifact('database.pgcustom', dump);
  // Frontend already mounts the same media volume read-only. Backend remains
  // stopped throughout the consistent DB/media capture and restore comparison.
  assert.equal(docker(['exec', 'uasspain-frontend', 'find', '/media_data', '!', '-type', 'f', '!', '-type', 'd']).toString().trim(), '', 'Unexpected special media file');
  media = docker(['exec', 'uasspain-frontend', 'tar', '-C', '/media_data', '-cf', '-', '.'], undefined, 120000);
  report.media_backup = encryptedArtifact('media.tar', media);
  report.phase = 'isolated_restore'; save();
  const database = `uasspain_audit_restore_${suffix}`;
  assert.equal(sql(`BEGIN READ ONLY; SELECT count(*) FROM pg_database WHERE datname='${database}'; COMMIT;`), '0');
  docker(['exec', 'uasspain-postgres', 'createdb', '-U', 'uasspain', '-T', 'template0', database]);
  report.recovery_database = database;
  sql(`REVOKE CONNECT ON DATABASE "${database}" FROM PUBLIC;`);
  const savedDump = readFileSync(resolve(privateRoot, 'database.pgcustom.enc'));
  const decrypt = createDecipheriv('aes-256-gcm', key, savedDump.subarray(0, 12)); decrypt.setAuthTag(savedDump.subarray(-16));
  dump.fill(0); dump = Buffer.concat([decrypt.update(savedDump.subarray(12, -16)), decrypt.final()]);
  assert.equal(sha(dump), report.database_backup.plain_sha256);
  docker(['exec', '-i', 'uasspain-postgres', 'pg_restore', '-U', 'uasspain', '--exit-on-error', '--no-owner', '--no-privileges', '--dbname', database], dump, 120000);
  const recovered = fingerprint(database);
  assert.deepEqual(recovered, before, 'Restored table content differs');
  const after = fingerprint();
  assert.deepEqual(after, before, 'Active DB changed during recovery control');
  assert.equal(sha(readFileSync(resolve(root, '.secrets/postgres-storage-key.dpapi'))), dpapi);
  sql(`ALTER DATABASE "${database}" ALLOW_CONNECTIONS false;`);
  report.recovery = { tables: recovered.length, rows: recovered.reduce((n, x) => n + x.rows, 0), restored_from_saved_encrypted_artifact: true, exact_table_fingerprints_equal: true, active_database_unchanged: true, profiles: 8, dpapi_unchanged: true, encrypted_pgdata: true, retained: true, connections_disabled: true, cleanup: 'NOT_RUN: no database deletion authorized or executed' };
  writeFileSync(resolve(privateRoot, 'manifest.json'), JSON.stringify({ ...report, private_artifact_directory: privateRoot }, null, 2) + '\n', { flag: 'wx' });
  report.phase = 'complete'; report.status = 'PASS';
} catch (error) {
  report.status = 'BLOCKED';
  report.reason = error instanceof assert.AssertionError ? 'Safety assertion failed; no deployment authorized by this result' : error.message;
  process.exitCode = 1;
} finally {
  dump?.fill(0); media?.fill(0); key?.fill(0); master?.fill(0);
  if (backendStopped) {
    try { docker(['start', 'uasspain-backend']); report.backend_restarted = true; }
    catch { report.backend_restarted = false; report.status = 'BLOCKED'; process.exitCode = 1; }
  }
  report.completed_at = new Date().toISOString(); save();
}
console.log(JSON.stringify({ report: 'docs/audits/evidence/2026-11-16-preupdate-backup.json', status: report.status, phase: report.phase, recovery: report.recovery, reason: report.reason || null }));
