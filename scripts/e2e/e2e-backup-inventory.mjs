// Real API/files/PostgreSQL/SFTP acceptance. auth-fixtures refuses MAIN origins
// and containers; every write below is confined to the labelled isolated stack.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { adminClient, apiClient, backend, postgres, check, sleep, sql, uuid } from './auth-fixtures.mjs';
const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const admin = await adminClient();
const call = (path, method = 'GET', body) => admin.call('/api/backups/' + path, method, body);
let passed = 0;
const gate = (condition, name) => { check(condition, name); passed++; console.log('PASS ' + name); };
const owned = randomUUID().replaceAll('-', '');
const localRoot = '/app/backups/inventory-' + owned;
let servers = (await call('servers/')).body;
for (const role of ['local', 'external_1', 'external_2']) {
  let server = servers.find(s => s.role === role);
  const config = role === 'local' ? { name: 'Inventory local', role, is_active: false, transfer_protocol: 'copy', smb_share: localRoot }
    : { name: 'Inventory ' + role, role, is_active: false, transfer_protocol: 'sftp', sftp_host: role === 'external_1' ? 'sftp-ext1-e2e' : 'sftp-ext2-e2e', sftp_port: 2222, sftp_user: role === 'external_1' ? 'backupsftp' : 'offsite', sftp_remote_path: '/backups' };
  const configured = await call(server ? `servers/${uuid(server.id)}/` : 'servers/', server ? 'PUT' : 'POST', config);
  gate([200, 201].includes(configured.status), 'configure_' + role);
  server = configured.body;
  gate((await call('test-connection/', 'POST', { server_id: server.id })).body.ok === true, 'authenticated_probe_' + role);
}
servers = (await call('servers/')).body;
const activate = async mask => {
  for (const [index, role] of ['local', 'external_1', 'external_2'].entries()) {
    const server = servers.find(s => s.role === role);
    gate((await call(`servers/${server.id}/`, 'PUT', { is_active: Boolean(mask & (1 << index)) })).status === 200, `active_${mask}_${role}`);
  }
};
const inventory = async () => (await call('inventory/?limit=100')).body;
const create = async type => {
  const response = await call('create/', 'POST', { type, background: true });
  gate(response.status === 202, 'creation_queued');
  for (let i = 0; i < 400; i++) {
    const job = (await inventory()).find(j => j.id === response.body.job_id);
    if (job && job.status !== 'creating') return job;
    await sleep(200);
  }
  throw Error('Backup operation timed out');
};
const replicas = job => Object.entries(job.destinations).filter(([, d]) => d.status === 'success');
const replicaOrigin = ([role, dest]) => role === 'local' ? 'local' : dest.server_id;
const storedFiles = () => docker(['exec', backend, 'find', '/app/backups', '-type', 'f']).split('\n').filter(Boolean);
const fixtures = [];
const remoteContainers = {};
for (const role of ['external_1', 'external_2']) {
  const container = docker(['compose', '-f', 'docker-compose.e2e.yml', 'ps', '-q', role === 'external_1' ? 'sftp-ext1-e2e' : 'sftp-ext2-e2e']);
  gate(docker(['inspect', '--format', '{{index .Config.Labels "com.docker.compose.project"}}', container]) === 'uasspain-e2e', 'matrix_remote_identity_' + role);
  remoteContainers[role] = container;
}
await activate(0);
const beforeDisabled = sql('SELECT count(*) FROM backups_backupjob');
gate((await call('create/', 'POST', { type: 'full' })).status === 400, 'no_active_destination_rejected');
gate(sql('SELECT count(*) FROM backups_backupjob') === beforeDisabled, 'no_destination_no_artifact_or_job');
for (let mask = 1; mask < 8; mask++) {
  await activate(mask);
  const job = await create('full'); fixtures.push(job);
  gate(job.status === 'completed' && job.verified && job.encrypted, 'matrix_completed_' + mask);
  gate(job.duration_milliseconds > 0, 'real_subsecond_duration_' + mask);
  for (const [index, role] of ['local', 'external_1', 'external_2'].entries()) {
    gate(job.destinations[role].status === (mask & (1 << index) ? 'success' : 'NOT_CONFIGURED'), `exact_storage_${mask}_${role}`);
    if (index > 0 && !(mask & (1 << index))) {
      docker(['exec', remoteContainers[role], 'sh', '-c', 'test ! -e "/backups/$1"', 'fixture', job.manifest.files.database.name]);
      gate(true, `inactive_remote_has_no_new_replica_${mask}_${role}`);
    }
  }
  const files = storedFiles(), name = job.manifest.files.database.name;
  const localCopies = files.filter(file => file.endsWith('/' + name));
  gate(localCopies.length === (mask & 1 ? 1 : 0), 'no_hidden_definitive_local_copy_' + mask);
  if (!(mask & 1)) {
    const names = [name, name + '.manifest.json', job.manifest.files.media?.name].filter(Boolean);
    gate(!files.some(file => names.some(name => file.endsWith('/' + name))), 'external_only_has_no_local_database_media_manifest_' + mask);
  }
  gate(!files.some(file => file.includes('.staging_') || file.includes('.remote_restore_')), 'owned_staging_clean_' + mask);
  for (const entry of replicas(job)) {
    const checked = await call('verify/', 'POST', { job_id: job.id, origin: replicaOrigin(entry) });
    gate(checked.status === 200 && checked.body.valid, 'readback_real_integrity_' + mask + '_' + entry[0]);
  }
  const drill = await call('restore-test/', 'POST', { job_id: job.id, origin: replicaOrigin(replicas(job)[0]) });
  gate(drill.status === 200 && drill.body.success && drill.body.tables > 0, 'real_isolated_recovery_' + mask);
  gate(sql("SELECT count(*) FROM pg_database WHERE datname LIKE 'uasspain_restore_test_%'") === '0', 'exact_drill_database_cleanup_' + mask);
}
const full = fixtures.at(-1);
await activate(2);
const first = await create('incremental'), second = await create('incremental');
gate(first.parent_backup_id === full.id && second.parent_backup_id === first.id && second.chain_index === 2, 'external_only_two_delta_chain');
gate((await call('restore-test/', 'POST', { job_id: second.id, origin: replicas(second)[0][1].server_id })).body.success, 'external_only_chain_decryption_reconstruction');
sql(`UPDATE backups_backupjob SET chain_index=chain_index+1 WHERE id='${uuid(second.id)}'`);
try {
  const invalid = await call('verify/', 'POST', { job_id: second.id, origin: replicas(second)[0][1].server_id });
  gate(invalid.body.valid === false && invalid.body.errors.includes('manifest_missing_or_invalid'), 'manifest_and_catalogue_dependencies_must_agree');
} finally { sql(`UPDATE backups_backupjob SET chain_index=${second.chain_index} WHERE id='${second.id}'`); }
gate((await call('verify/', 'POST', { job_id: second.id, origin: replicas(second)[0][1].server_id })).body.valid, 'correct_chain_metadata_revalidated');
await activate(0);
gate((await call('verify/', 'POST', { job_id: second.id, origin: replicas(second)[0][1].server_id })).body.valid, 'disabled_historical_destination_readable');
gate((await call('servers/')).body.every(s => !s.is_active), 'historical_read_does_not_reactivate');

// Corrupt exactly one owned replica, retaining its byte-for-byte original.
const localFile = sql(`SELECT storage_path FROM backups_backupjob WHERE id='${uuid(full.id)}'`);
check(localFile.startsWith(localRoot + '/'), 'Owned local replica root');
docker(['exec', backend, 'cp', localFile, localFile + '.test-held']);
try {
  docker(['exec', backend, 'sh', '-c', 'printf corruption >> "$1"', 'fixture', localFile]);
  gate((await call('verify/', 'POST', { job_id: full.id, origin: 'local' })).body.valid === false, 'selected_corrupt_replica_cannot_fallback');
  gate((await inventory()).find(job => job.id === full.id).verified, 'bad_replica_does_not_invalidate_other_verified_replicas');
  gate((await call('restore-test/', 'POST', { job_id: full.id, origin: replicas(full).find(([r]) => r === 'external_1')[1].server_id })).body.success, 'good_replica_remains_recoverable_after_other_replica_fails');
  gate((await call('verify/', 'POST', { job_id: full.id, origin: replicas(full).find(([r]) => r === 'external_1')[1].server_id })).body.valid, 'independent_good_replica_still_validates');
} finally { docker(['exec', backend, 'mv', localFile + '.test-held', localFile]); }
gate((await call('verify/', 'POST', { job_id: full.id, origin: 'local' })).body.valid, 'restored_owned_replica_revalidates');
gate((await call('verify/', 'POST', {})).status === 400, 'verification_requires_exact_id');
gate((await call('restore-test/', 'POST', {})).status === 400, 'recovery_requires_exact_id');
gate((await call('restore/', 'POST', { origin: 'local', confirmed: true, confirmation_text: 'RESTAURAR' })).status === 400, 'restore_requires_exact_id');
gate((await call('verify/', 'POST', { job_id: full.id, origin: '../other' })).status === 400, 'manipulated_origin_rejected_without_fallback');
gate((await call('verify/', 'POST', { job_id: full.id, origin: 'local' })).body.valid, 'negative_origin_test_repaired_by_real_check');
gate((await call('restore/', 'POST', { job_id: full.id, origin: 'local', confirmed: true })).status === 400, 'restore_requires_explicit_literal');
const learner = apiClient();
gate((await learner.call('/api/auth/login/', 'POST', { email: 'alumno.e2e@test.local', password: 'E2ePass_2026!' })).status === 200, 'isolated_learner_login'); // pragma: allowlist secret - isolated fixture
for (const [path, method, body] of [['inventory/'], ['history/'], ['history/clear/', 'POST', { confirmed: true, ids: [] }], ['verify/', 'POST', { job_id: full.id }], ['restore-test/', 'POST', { job_id: full.id }], ['restore/', 'POST', { job_id: full.id, origin: 'local', confirmed: true }]]) {
  gate((await learner.call('/api/backups/' + path, method || 'GET', body)).status === 403, 'admin_only_' + path);
}

const before = JSON.stringify(await inventory());
const filesBefore = storedFiles().join('\n');
const configBefore = sql("SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM backups_backupconfig t");
const audits = Number(sql('SELECT count(*) FROM core_auditlog'));
const visible = (await call('history/?limit=10')).body.filter(op => op.finished_at).map(op => op.id);
gate((await call('history/clear/', 'POST', { ids: visible, confirmed: false })).status === 400, 'clear_requires_confirmation');
const cleared = await call('history/clear/', 'POST', { ids: visible, confirmed: true });
gate(cleared.status === 200 && cleared.body.cleared === visible.length, 'clear_only_exact_visible_finished_ids');
gate(JSON.stringify(await inventory()) === before, 'clear_keeps_catalogue_chain_and_checks_byte_identical');
gate(storedFiles().join('\n') === filesBefore && sql("SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM backups_backupconfig t") === configBefore, 'clear_preserves_files_and_configuration');
gate(Number(sql('SELECT count(*) FROM core_auditlog')) === audits + 1, 'clear_appends_protected_audit');
gate((await call('history/?limit=100')).body.every(op => !visible.includes(op.id)), 'history_clear_persists');
gate(!(JSON.stringify(await inventory()).includes('storage_path') || JSON.stringify(await inventory()).includes('"path":')), 'inventory_does_not_expose_storage_paths');
const operation = uuid(randomUUID());
sql(`INSERT INTO backups_operation(id,backup_job_id,operation_type,status,started_at) VALUES('${operation}','${full.id}','integrity','running',NOW())`);
gate((await call('history/clear/', 'POST', { confirmed: true, ids: [operation] })).body.cleared === 0, 'active_history_operation_is_not_disposable');
sql(`DELETE FROM backups_operation WHERE id='${operation}' AND backup_job_id='${full.id}'`);

await activate(3);
const external = docker(['compose', '-f', 'docker-compose.e2e.yml', 'ps', '-q', 'sftp-ext1-e2e']);
gate(docker(['inspect', '--format', '{{index .Config.Labels "com.docker.compose.project"}}', external]) === 'uasspain-e2e', 'partial_fixture_container_identity');
docker(['exec', '-u', '0', external, 'chmod', '500', '/backups']);
try {
  const partial = await create('full');
  gate(partial.status === 'partial' && partial.verified && partial.destinations.local.status === 'success' && partial.destinations.external_1.status === 'failed', 'partial_transfer_global_and_replica_statuses');
} finally { docker(['exec', '-u', '0', external, 'chmod', '750', '/backups']); }
await activate(4);
const offline = docker(['compose', '-f', 'docker-compose.e2e.yml', 'ps', '-q', 'sftp-ext2-e2e']);
gate(docker(['inspect', '--format', '{{index .Config.Labels "com.docker.compose.project"}}', offline]) === 'uasspain-e2e', 'offline_fixture_container_identity');
docker(['stop', offline]);
try {
  const failed = await create('full');
  gate(failed.status === 'connection_failed' && !failed.verified && failed.destinations.external_2.status === 'failed', 'all_destinations_failed_is_not_success');
  gate(!storedFiles().some(file => file.endsWith('/' + failed.manifest.files.database.name) || file.includes('.staging_')), 'failed_external_only_no_local_residue');
} finally { docker(['start', offline]); }
await activate(1);
const persisted = JSON.stringify(await inventory());
docker(['restart', backend]);
for (let i = 0; i < 100; i++) { try { if ((await admin.call('/api/health/ready/')).status === 200) break; } catch {} await sleep(200); }
gate(JSON.stringify(await inventory()) === persisted, 'inventory_survives_backend_restart');
gate(sql("SELECT count(*) FROM pg_database WHERE datname LIKE 'uasspain_restore_test_%'") === '0', 'final_no_disposable_restore_database');
gate(docker(['inspect', '--format', '{{index .Config.Labels "com.docker.compose.project"}}', postgres]) === 'uasspain-e2e', 'all_writes_remained_isolated');
console.log(`BACKUP_INVENTORY_API_E2E=${passed} PASS MAIN_WRITES=0`);
