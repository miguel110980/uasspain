// Local operator tool, not an HTTP endpoint. It records only the initial five
// preparation gates after checking their concrete reports and preserved data.
// It cannot verify a provider, activate API or claim completed cutover.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const directory = realpathSync(resolve(process.argv[2] || '.run/mail-system-20261012'));
const reportsRoot = realpathSync(resolve('.run')) + sep;
assert.ok(directory.startsWith(reportsRoot), 'Evidence must be inside this workspace .run');
const read = name => readFileSync(resolve(directory, name), 'utf8').replace(/^\uFEFF/, '');
const json = name => JSON.parse(read(name));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const docker = (args, input) => {
  try { return execFileSync('docker', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }).trim(); }
  catch { throw new Error('Guarded local mail preparation operation failed'); }
};
const sql = text => docker(['exec', '-i', 'uasspain-postgres', 'psql', '-U', 'uasspain', '-d', 'uasspain', '-qAt', '-v', 'ON_ERROR_STOP=1'], text);
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const inventory = json('pre-migration-backup/inventory.json');
assert.equal(inventory.origin, 'https://localhost');
assert.equal(inventory.profiles.length, 0);
assert.equal(inventory.backup.restoreVerified, true);
assert.equal(hash(readFileSync(resolve(directory, 'pre-migration-backup/pre-test-snapshot.enc'))), inventory.backup.sha256);
const preservation = json('preservation.json');
assert.equal(preservation.existingRowsModified, 0); assert.equal(preservation.existingRowsDeleted, 0);
assert.equal(preservation.tables, inventory.backup.tables); assert.equal(preservation.existingRowsChecked, inventory.backup.rows);
assert.equal(preservation.persistentVolumes, 'UNCHANGED'); assert.equal(preservation.migration, 27);
const acceptance = json('preparation-gates.json');
assert.equal(acceptance.source, 'observed_local_validation');
assert.equal(acceptance.rust, 'PASS'); assert.equal(acceptance.frontend, 'PASS'); assert.equal(acceptance.apiRegression, 'PASS');
assert.equal(acceptance.browser, 'PASS'); assert.equal(acceptance.security, 'PASS');
const runtime = json('runtime-proof.json');
assert.equal(runtime.backendHash, acceptance.backendHash);
assert.equal(runtime.frontendVersion.buildId, acceptance.frontendBuildId);
const info = JSON.parse(docker(['inspect', 'uasspain-postgres', 'uasspain-backend', 'uasspain-frontend']));
assert.ok(info.every(container => container.Config.Labels['com.docker.compose.project'] === 'uasspain' && container.State.Health.Status === 'healthy'));
assert.equal(docker(['exec', 'uasspain-backend', 'sha256sum', '/usr/local/bin/uasspain-backend']).split(' ')[0], acceptance.backendHash);
assert.equal(sql('SELECT max(version) FROM _sqlx_migrations WHERE success'), '27');
// Only report token availability; never read or print its value.
const available = docker(['exec', 'uasspain-backend', 'sh', '-c', 'if [ -n "$POSTMARK_SERVER_TOKEN_FILE" ] && [ -s "$POSTMARK_SERVER_TOKEN_FILE" ]; then printf configured; elif [ -n "$POSTMARK_SERVER_TOKEN" ]; then printf configured; else printf missing; fi']) === 'configured';
const id = randomUUID(), attempt = randomUUID();
const stages = ['AUDITED', 'BACKUP_VERIFIED', 'SCHEMA_EXPANDED', 'DATA_MIGRATED', 'DATA_VERIFIED'];
const evidence = {
  AUDITED: { source: 'local_code_and_runtime_audit', responsible: 'local_operator_tool', backend_hash: acceptance.backendHash, frontend_build: acceptance.frontendBuildId },
  BACKUP_VERIFIED: { source: 'encrypted_snapshot_restored_offline', checksum: inventory.backup.sha256, tables: inventory.backup.tables, rows: inventory.backup.rows, verified_at: inventory.backup.createdAt },
  SCHEMA_EXPANDED: { source: 'runtime_migration', version: 27 },
  DATA_MIGRATED: { source: 'compatible_expansion', smtp_preserved: true, previous_structures_removed: false },
  DATA_VERIFIED: { source: 'row_and_file_fingerprints_and_regression', responsible: 'local_operator_tool', existing_rows_preserved: preservation.existingRowsChecked, backups_preserved: preservation.backupFilesPreserved, tests: acceptance },
};
const commands = ['BEGIN;', 'SELECT pg_advisory_xact_lock(724851904);'];
commands.push("DO $$ BEGIN IF EXISTS(SELECT 1 FROM mail_migration WHERE state<>'NOT_STARTED' AND NOT(state='BLOCKED' AND last_passed='DATA_VERIFIED')) THEN RAISE EXCEPTION 'Unexpected migration state: preparation cannot replace provider verification or cutover'; END IF; END $$;");
commands.push(`INSERT INTO mail_migration(id,attempt_id) SELECT '${id}','${attempt}' WHERE NOT EXISTS(SELECT 1 FROM mail_migration);`);
let previous = 'NOT_STARTED';
for (const stage of stages) {
  const ev = quote(JSON.stringify(evidence[stage]));
  commands.push(`INSERT INTO mail_migration_transition(id,migration_id,attempt_id,previous_state,new_state,software_version,schema_version,evidence,last_passed) SELECT '${randomUUID()}',id,attempt_id,state,'${stage}','0.1.0',27,${ev}::jsonb,'${stage}' FROM mail_migration WHERE state='${previous}';`);
  commands.push(`UPDATE mail_migration SET state='${stage}',last_passed='${stage}',version=version+1,updated_at=NOW() WHERE state='${previous}';`);
  previous = stage;
}
// Credential availability does not imply an authorized sender or delivery.
commands.push(`INSERT INTO mail_migration_transition(id,migration_id,attempt_id,previous_state,new_state,software_version,schema_version,evidence,error_code,corrective_action,last_passed) SELECT '${randomUUID()}',id,attempt_id,state,'BLOCKED','0.1.0',27,${quote(JSON.stringify({ source: 'known_external_prerequisites', server_secret_available: available, sender_verified: false, real_inbox_validation: 'DEFERRED_UNTIL_PRODUCTION' }))}::jsonb,'sender_unconfirmed','Confirmar remitente autorizado en Postmark y comprobar recepción y Responder en el buzón durante producción.',last_passed FROM mail_migration WHERE state='DATA_VERIFIED';`);
commands.push("UPDATE mail_migration SET state='BLOCKED',version=version+1,updated_at=NOW() WHERE state='DATA_VERIFIED';");
commands.push("DO $$ BEGIN IF (SELECT count(*) FROM mail_migration WHERE state='BLOCKED' AND last_passed='DATA_VERIFIED')<>1 THEN RAISE EXCEPTION 'Preparation gates were not recorded'; END IF; END $$;", 'COMMIT;');
sql(commands.join('\n'));
const recorded = JSON.parse(sql("SELECT jsonb_build_object('id',id,'attemptId',attempt_id,'state',state,'lastPassed',last_passed,'version',version,'transitions',(SELECT count(*) FROM mail_migration_transition WHERE migration_id=mail_migration.id)) FROM mail_migration"));
assert.equal(recorded.state, 'BLOCKED'); assert.equal(recorded.lastPassed, 'DATA_VERIFIED');
console.log(JSON.stringify({ preparationRecorded: true, migration: recorded, providerSecretAvailable: available, apiActivation: 'NOT_RUN', sender: 'UNCONFIRMED', corporateReception: 'DEFERRED_UNTIL_PRODUCTION' }));
