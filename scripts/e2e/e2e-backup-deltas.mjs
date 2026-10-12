import { execFileSync } from 'node:child_process';
import { adminClient, backend, check, loginFixtureAdministrator, sleep, sql, uuid } from './auth-fixtures.mjs';

const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const admin = await adminClient();
const call = (path, method = 'GET', body) => admin.call('/api/backups/' + path, method, body);
const finish = async id => {
  for (let attempt = 0; attempt < 300; attempt++) {
    const job = (await call('history/?limit=100')).body.find(j => j.id === id);
    if (job && job.status !== 'creating') {
      check(job.status === 'completed' && job.verified && job.encrypted, 'Verified encrypted recovery point');
      return job;
    }
    await sleep(200);
  }
  throw Error('Delta recovery point did not finish');
};
const create = async type => {
  const response = await call('create/', 'POST', { type, background: true });
  check(response.status === 202, 'Create requested type');
  return finish(uuid(response.body.job_id));
};
const media = text => docker(['exec', backend, 'sh', '-c', 'printf %s "$1" > /app/media/backup-delta-fixture.txt', 'fixture', text]);
const fingerprint = () => sql("SELECT count(*)||':'||md5(string_agg(id||':'||payload,',' ORDER BY id)) FROM backup_incremental_fixture");
sql("SET ROLE uasspain_migrator; CREATE TABLE backup_incremental_fixture(id integer PRIMARY KEY,payload text); INSERT INTO backup_incremental_fixture SELECT i,repeat(md5(i::text),64) FROM generate_series(1,2000) i;");
media('full media state');
const original = fingerprint();
const full = await create('full');
check(full.job_type === 'full' && full.manifest.files.database.encoding === 'snapshot', 'FULL stores a snapshot');
check((await call('restore-test/', 'POST', { job_id: full.id })).body.success === true, 'FULL isolated drill');
sql("SET ROLE uasspain_migrator; UPDATE backup_incremental_fixture SET payload='changed' WHERE id=10; DELETE FROM backup_incremental_fixture WHERE id=20; INSERT INTO backup_incremental_fixture VALUES(3000,'inserted');");
media('incremental media state');
const first = await create('incremental');
check(first.parent_backup_id === full.id && first.base_full_id === full.id && first.chain_index === 1, 'First incremental records its base');
check(first.manifest.files.database.encoding === 'delta-v1' && first.manifest.files.media.encoding === 'delta-v1', 'Database and media use deltas');
check(first.size_bytes < full.size_bytes / 2, 'Controlled change stores less than half the FULL database');
sql("SET ROLE uasspain_migrator; UPDATE backup_incremental_fixture SET payload='second point' WHERE id=30;");
media('second incremental media state');
const expected = fingerprint();
const second = await create('incremental');
check(second.parent_backup_id === first.id && second.base_full_id === full.id && second.chain_index === 2, 'Second incremental depends on the prior delta');
for (const job of [full, first, second]) check((await call('verify/', 'POST', { job_id: job.id })).body.valid === true, 'Artifact and reconstructed-state integrity');
const source = sql(`SELECT storage_path FROM backups_backupjob WHERE id='${uuid(full.id)}'`);
check(/^\/app\/backups\/uasspain_full_[a-z0-9_.]+\.enc$/.test(source), 'Owned isolated FULL filename');
docker(['exec', backend, 'mv', source, source + '.audit-held']);
try {
  check((await call('restore-test/', 'POST', { job_id: second.id })).status === 400, 'Missing ancestor prevents restoration');
  check(fingerprint() === expected, 'Rejected drill leaves database unchanged');
} finally { docker(['exec', backend, 'mv', source + '.audit-held', source]); }
check((await call('restore-test/', 'POST', { job_id: second.id })).body.success === true, 'FULL plus two deltas drill');
async function restore(job, role) {
  const server = (await call('servers/')).body.find(s => s.role === role && s.is_active);
  const available = (await call('origins/?origin=' + server.id)).body.available.find(j => j.id === job.id);
  check(Boolean(available), 'Replicated recovery point is available');
  const response = await call('restore/', 'POST', { origin: server.id, filename: available.filename, confirmed: true, confirmation_text: 'RESTAURAR' });
  check(response.status === 202, 'Isolated restore queued');
  let reauthenticatedAfterRestore = false;
  for (let attempt = 0; attempt < 300; attempt++) {
    const result = await call('restore-status/?restore_id=' + response.body.restore_id);
    if (result.status === 401 && !reauthenticatedAfterRestore) {
      await loginFixtureAdministrator(admin);
      reauthenticatedAfterRestore = true;
      continue;
    }
    const state = result.body;
    if (state.state === 'done') { check(state.checksum_verified, 'Restore verified'); return; }
    check(state.state !== 'failed', 'Restore must recover real PostgreSQL data');
    await sleep(200);
  }
  throw Error('Isolated delta restore did not finish');
}
await restore(second, 'external_1');
check(fingerprint() === expected, 'FULL plus deltas reconstruct inserted, changed and deleted data');
check(docker(['exec', backend, 'cat', '/app/media/backup-delta-fixture.txt']) === 'second incremental media state', 'Incremental media restored');
await restore(full, 'external_2');
check(fingerprint() === original, 'FULL restores the original data exactly');
check(docker(['exec', backend, 'cat', '/app/media/backup-delta-fixture.txt']) === 'full media state', 'FULL media restored');
sql('SET ROLE uasspain_migrator; DROP TABLE backup_incremental_fixture;');
docker(['exec', backend, 'rm', '/app/media/backup-delta-fixture.txt']);
console.log('FULL_LOCAL=PASS INCREMENTAL_LOCAL=PASS RESTORE_FULL=PASS RESTORE_INCREMENTAL=PASS INTEGRITY=PASS ISOLATED_EXTERNAL_1=PASS ISOLATED_EXTERNAL_2=PASS');
