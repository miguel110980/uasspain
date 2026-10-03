import { execFileSync } from 'node:child_process';
import { adminClient, apiClient, check, sleep, sql, uuid } from './auth-fixtures.mjs';

let passed = 0;
const gate = (condition, name) => { check(condition, name); passed++; console.log(`PASS | backup_${name}`); };
const admin = await adminClient();
const backend = execFileSync('docker', ['compose', '-f', 'docker-compose.e2e.yml', 'ps', '-q', 'backend-e2e'], { encoding: 'utf8' }).trim();
const remote = execFileSync('docker', ['compose', '-f', 'docker-compose.e2e.yml', 'ps', '-q', 'sftp-ext1-e2e'], { encoding: 'utf8' }).trim();
const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const call = (path, method, body) => admin.call('/api/backups/' + path, method, body);
for (const server of (await call('servers/')).body) check((await call(`servers/${uuid(server.id)}/`, 'DELETE')).status === 204, 'Isolated destination reset');
const history = async () => (await call('history/?limit=100')).body;
const finish = async id => {
  for (let attempt = 0; attempt < 300; attempt++) {
    const job = (await history()).find(row => row.id === id);
    if (job && job.status !== 'creating') return job;
    await sleep(200);
  }
  throw Error('Backup did not finish');
};
const teacher = apiClient(), student = apiClient();
check((await teacher.call('/api/auth/login/', 'POST', { email: 'instructor.e2e@test.local', password: 'E2eInstr_2026!' })).status === 200, 'Instructor login'); // pragma: allowlist secret - isolated fixture
check((await student.call('/api/auth/login/', 'POST', { email: 'alumno.e2e@test.local', password: 'E2ePass_2026!' })).status === 200, 'Student login'); // pragma: allowlist secret - isolated fixture
for (const [path, method, body] of [['status/'], ['history/'], ['config/'], ['servers/'], ['config/', 'PUT', { value: {} }], ['create/', 'POST', { type: 'full' }], ['test-connection/', 'POST', {}], ['verify/', 'POST', {}], ['restore/', 'POST', { origin: 'local', confirmed: true }], ['retention/', 'POST', {}]]) {
  for (const actor of [teacher, student, apiClient()]) gate((await actor.call('/api/backups/' + path, method || 'GET', body)).status === (actor === teacher || actor === student ? 403 : 401), 'admin_only_' + path + '_' + (actor === teacher ? 'instructor' : actor === student ? 'student' : 'anonymous'));
}
gate((await call('status/')).body.system_status === 'not_configured', 'empty_installation_not_configured');
const saved = await call('config/', 'PUT', { key: 'backups', value: { frequency: 'weekly', day: '1', hour: '03:15', job_type: 'automatic', retention_days: 15, encrypt: true } });
gate(saved.status === 200 && saved.body.value.retention_full === 15 && saved.body.value.retention_incremental === 15 && saved.body.value.retention_policy === 'unified', 'simple_schedule_maps_to_safe_policy');
gate((await call('config/', 'PUT', { value: { encrypt: false } })).status === 400 && (await call('create/', 'POST', { encrypt: false })).status === 400, 'encryption_cannot_be_disabled');
gate((await call('config/', 'PUT', { value: { retention_days: 0 } })).status === 400, 'invalid_retention_rejected');
const local = await call('servers/', 'POST', { role: 'local', name: 'Copias locales', transfer_protocol: 'copy', smb_share: '', is_active: false });
gate(local.status === 201 && !local.body.is_active, 'local_storage_configured_without_internal_paths_or_ip');
gate((await call('test-connection/', 'POST', { server_id: local.body.id })).body.ok === true, 'local_probe_writes_reads_and_deletes');
gate((await call(`servers/${local.body.id}/`, 'PUT', { is_active: true })).body.is_active === true, 'local_activation_validates_current_configuration');
gate((await call('servers/', 'POST', { role: 'local', name: 'Duplicado', is_active: false })).status === 409, 'destination_slot_unique');
const remotes = [];
for (const [role, host, user] of [['external_1', 'sftp-ext1-e2e', 'backupsftp'], ['external_2', 'sftp-ext2-e2e', 'offsite']]) {
  const result = await call('servers/', 'POST', { role, name: `Copias ${role}`, sftp_host: host, sftp_port: 2222, sftp_user: user, sftp_remote_path: '/backups', is_active: false });
  gate(result.status === 201 && result.body.key_configured && result.body.identity_configured && !Object.hasOwn(result.body, 'sftp_key_path') && !Object.hasOwn(result.body, 'sftp_known_hosts'), `${role}_uses_system_secrets_and_resolves_one_address`);
  remotes.push(result.body);
  const probe=await call('test-connection/', 'POST', { server_id: result.body.id });
  if (!probe.body.ok) console.log('Safe connection result:', JSON.stringify(probe.body));
  gate(probe.body.ok === true, `${role}_real_sftp_write_read_delete_probe`);
  gate((await call(`servers/${result.body.id}/`, 'PUT', { is_active: true })).body.is_active === true, `${role}_activation`);
}
const external = remotes[0];
docker(['exec', backend, 'touch', '/app/backup_keys/untrusted_hosts']);
await call(`servers/${external.id}/`, 'PUT', { sftp_known_hosts: '/app/backup_keys/untrusted_hosts' });
const identity=await call('test-connection/', 'POST', { server_id: external.id });
gate(!identity.body.ok && identity.body.code==='server_identity', 'unknown_host_identity_is_rejected');
gate((await call(`servers/${external.id}/`, 'PUT', { is_active:true })).status===400, 'unknown_host_cannot_be_activated');
await call(`servers/${external.id}/`, 'PUT', { sftp_known_hosts: '/app/backup_keys/known_hosts' });
await call('test-connection/', 'POST', { server_id:external.id });
await call(`servers/${external.id}/`, 'PUT', { is_active:true });
await call(`servers/${external.id}/`, 'PUT', { sftp_remote_path: '/missing-backup-folder' });
gate((await call(`servers/${external.id}/`)).body.is_active === false && (await call(`servers/${external.id}/`)).body.configuration_validated === false, 'configuration_change_invalidates_activation');
const folder = await call('test-connection/', 'POST', { server_id: external.id });
gate(!folder.body.ok && folder.body.code === 'folder', 'missing_remote_folder_not_reported_connected');
gate((await call(`servers/${external.id}/`, 'PUT', { is_active: true })).status === 400, 'invalid_destination_cannot_activate');
await call(`servers/${external.id}/`, 'PUT', { sftp_remote_path: '/backups', sftp_user: 'wrong-user' });
const denied = await call('test-connection/', 'POST', { server_id: external.id });
gate(!denied.body.ok && denied.body.code === 'credentials' && !JSON.stringify(denied.body).includes('/app/backup_keys'), 'authentication_error_is_safe');
await call(`servers/${external.id}/`, 'PUT', { sftp_user: 'backupsftp' });
await call('test-connection/', 'POST', { server_id: external.id });
await call(`servers/${external.id}/`, 'PUT', { is_active: true });
const concurrent = await Promise.all([0, 1].map(() => call('create/', 'POST', { type: 'full', background: true })));
gate(concurrent.filter(result => result.status === 202).length === 1 && concurrent.filter(result => result.status === 409).length === 1, 'background_backup_prevents_duplicate_execution');
const full = await finish(uuid(concurrent.find(result => result.status === 202).body.job_id));
gate(full.status === 'completed' && full.job_type === 'full' && full.encrypted && full.verified && full.manifest_checksum && Object.values(full.destinations).every(destination => destination.status === 'success'), 'encrypted_full_verified_and_replicated_to_three_targets');
gate(!Object.hasOwn(full, 'storage_path') && !Object.hasOwn(full, 'media_path') && !Object.hasOwn(full, 'manifest_path'), 'history_hides_internal_paths');
gate((await call('verify/', 'POST', { job_id: full.id })).body.valid === true, 'hash_decryption_and_postgres_archive_verification');
gate((await call('restore-test/', 'POST', { job_id: full.id })).body.success === true, 'real_restore_drill');
const second = await call('create/', 'POST', { type: 'automatic', background: true });
const incremental = await finish(uuid(second.body.job_id));
gate(incremental.job_type === 'incremental' && incremental.status === 'completed' && incremental.parent_backup_id === full.id && incremental.base_full_id === full.id && incremental.chain_index === 1, 'automatic_strategy_preserves_incremental_chain');
gate((await call(`${full.id}/`, 'DELETE', { confirmed: true })).status === 400, 'required_chain_base_cannot_be_deleted');
const firstPage = (await call('history/?limit=1&offset=0')).body, nextPage = (await call('history/?limit=1&offset=1')).body;
gate(firstPage.length === 1 && nextPage.length === 1 && firstPage[0].id !== nextPage[0].id, 'history_pagination');
// Exercise a real unavailable mandatory destination without changing its saved
// configuration: server permissions change outside UASSpain.
docker(['exec', '-u', '0', remote, 'chmod', '500', '/backups']);
try {
  const partial = await call('create/', 'POST', { type: 'incremental', background: true });
  const job = await finish(uuid(partial.body.job_id));
  gate(job.status === 'partial' && job.destinations.external_1.status === 'failed' && job.verified, 'partial_replication_is_not_complete_success');
  gate((await call('status/')).body.system_status === 'attention', 'partial_copy_sets_attention_state');
} finally { docker(['exec', '-u', '0', remote, 'chmod', '750', '/backups']); }
// Before testing restore, keep a recovery point newer than the one selected.
sql(`UPDATE backups_backupjob SET created_date=NOW()-INTERVAL '20 days' WHERE id='${full.id}'`);
gate((await call('retention/', 'POST', {})).status === 200 && sql(`SELECT count(*) FROM backups_backupjob WHERE id='${full.id}'`) === '1', 'retention_keeps_ancestors_needed_by_live_chain');
gate((await call('restore/', 'POST', { origin: 'local', job_id: full.id, confirmed: true })).status === 400, 'restore_requires_reinforced_confirmation');
const restore = await call('restore/', 'POST', { origin: 'local', job_id: full.id, confirmed: true, confirmation_text: 'RESTAURAR' });
gate(restore.status === 202, 'restore_is_queued');
let restored;
for (let attempt = 0; attempt < 180; attempt++) {
  const result = await call(`restore-status/?restore_id=${restore.body.restore_id}`);
  if (result.body?.state === 'done' || result.body?.state === 'failed') { restored = result.body; break; }
  await sleep(300);
}
if (restored?.state !== 'done') console.error('Restore E2E result:', JSON.stringify(restored));
gate(restored?.state === 'done' && restored.checksum_verified === true, 'real_restore_validates_and_recovers_postgres');
gate(sql('SELECT count(*) FROM _sqlx_migrations WHERE success') === '16', 'restored_database_matches_migrations');
gate(Number(sql("SELECT count(*) FROM core_auditlog WHERE action LIKE 'backup_%'")) >= 5, 'operations_are_audited');
// An internal safety dump has no recovery manifest. It must not replace the
// final recovery point usable from the panel in the retention protection.
sql(`UPDATE backups_backupjob SET created_date=NOW()-INTERVAL '20 days' WHERE id='${full.id}'`);
gate((await call('retention/', 'POST', {})).status === 200 && sql(`SELECT count(*) FROM backups_backupjob WHERE id='${full.id}' AND verified AND manifest_checksum<>''`) === '1', 'retention_keeps_last_usable_point_beside_newer_safety_dump');
gate(sql("SELECT bool_and(NOT rolsuper AND NOT rolcreaterole) FROM pg_roles WHERE rolname IN ('uasspain_app','uasspain_migrator','uasspain_backup','uasspain_restore')") === 't', 'production_roles_are_not_superusers');
gate(sql("SELECT NOT has_table_privilege('uasspain_app','_sqlx_migrations','INSERT') AND NOT has_table_privilege('uasspain_backup','auth_user','INSERT') AND NOT has_schema_privilege('uasspain_app','public','CREATE')") === 't', 'restoration_preserves_minimum_privileges');
gate(sql("SELECT bool_and(pg_get_userbyid(relowner)='uasspain_migrator') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'") === 't', 'restored_tables_remain_owned_by_migrator');
sql("BEGIN; SET LOCAL ROLE uasspain_migrator; CREATE TABLE public.backup_future_migration_probe(id integer); DO $$ BEGIN IF NOT has_table_privilege('uasspain_app','public.backup_future_migration_probe','INSERT') OR NOT has_table_privilege('uasspain_backup','public.backup_future_migration_probe','SELECT') THEN RAISE EXCEPTION 'Restored default privileges missing'; END IF; END $$; ROLLBACK;");
gate(true, 'future_migrations_keep_runtime_and_backup_permissions');
const postRestore = await call('create/', 'POST', { type: 'full', background: true });
gate(postRestore.status === 202 && (await finish(uuid(postRestore.body.job_id))).status === 'completed', 'new_backup_works_after_restore_with_read_only_backup_role');
console.log(`BACKUPS_API_E2E=${passed} PASS`);
