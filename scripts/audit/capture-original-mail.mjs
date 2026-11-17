/** Read-only DB evidence around the single explicitly authorized UI mail test. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const beforePath = resolve(root, '.run/audit-20261116/external-mail-before.json');
const output = resolve(root, 'docs/audits/evidence/2026-11-16-external-mail.json');
function sql(query) { assert.ok(/^SELECT\b/.test(query)); return JSON.parse(execFileSync('docker', ['exec', '-i', 'uasspain-postgres', 'psql', '-X', '-U', 'uasspain', '-d', 'uasspain', '-qtA', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: `BEGIN READ ONLY; SET LOCAL statement_timeout='20s'; ${query}; COMMIT;`, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })); }
const sha = v => createHash('sha256').update(v).digest('hex');
const configuration = sql("SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) FROM core_systemsetting WHERE key IN ('smtp','smtp_service_contact','smtp_service_automatic','mail_mode')");
for (const name of ['smtp_service_contact', 'smtp_service_automatic']) if (configuration[name]) delete configuration[name].proofs;
const identity = sql("SELECT COALESCE(jsonb_agg(to_jsonb(p)||jsonb_build_object('auth_digest',md5(to_jsonb(u)::text)) ORDER BY p.id),'[]'::jsonb) FROM accounts_userprofile p JOIN auth_user u ON p.user_id=u.id");
const ids = sql("SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM mail_outbox");
const baseline = { observed_at: new Date().toISOString(), outbox_ids: ids, configuration_sha256: sha(JSON.stringify(configuration)), identity_sha256: sha(JSON.stringify(identity)), profile_count: identity.length, dpapi_sha256: sha(readFileSync(resolve(root, '.secrets/postgres-storage-key.dpapi'))) };
if (process.argv.includes('--before')) {
  assert.ok(!existsSync(beforePath), 'A prepared/sent single test must not be silently replaced');
  writeFileSync(beforePath, JSON.stringify(baseline, null, 2) + '\n');
  writeFileSync(output, JSON.stringify({ observed_at: baseline.observed_at, scope: 'Single authorized external SMTP test via genuine administrator UI on ORIGINAL; recipient retained only in chat/private runtime', status: 'PREPARED', delivery: 'NOT_RUN', smtp_acceptance: 'NOT_RUN', smtp_service: 'automatic', authorized_message_limit: 1, prior_outbox_rows: ids.length, configuration_changes: false, secrets_in_report: false }, null, 2) + '\n');
  console.log(JSON.stringify({ phase: 'PREPARED', prior_rows: ids.length }));
} else {
  const before = JSON.parse(readFileSync(beforePath, 'utf8'));
  const report = JSON.parse(readFileSync(output, 'utf8'));
  const added = ids.filter(id => !before.outbox_ids.includes(id));
  report.observed_at = new Date().toISOString();
  report.new_rows = added.length;
  report.previous_outbox_rows_retained = before.outbox_ids.every(id => ids.includes(id));
  report.configuration_preserved_excluding_test_proofs = baseline.configuration_sha256 === before.configuration_sha256;
  report.profile_and_auth_records_preserved = baseline.identity_sha256 === before.identity_sha256 && baseline.profile_count === 8;
  report.dpapi_preserved = baseline.dpapi_sha256 === before.dpapi_sha256;
  if (added.length === 1) {
    assert.match(added[0], /^[a-f0-9-]{36}$/i);
    report.message = sql(`SELECT json_build_object('id',id,'type',message_type,'provider',provider,'state',state,'attempts',attempts,'last_error',last_error,'service',validity->>'smtp_service','created_at',created_at,'updated_at',updated_at) FROM mail_outbox WHERE id='${added[0]}'`);
    report.smtp_acceptance = report.message.state === 'ACCEPTED' ? 'PASS' : report.message.state === 'FAILED' ? 'FAIL' : 'BLOCKED';
  } else report.smtp_acceptance = added.length > 1 ? 'FAIL' : 'NOT_RUN';
  report.status = added.length === 1 && report.previous_outbox_rows_retained && report.configuration_preserved_excluding_test_proofs && report.profile_and_auth_records_preserved && report.dpapi_preserved ? (report.delivery === 'PASS' ? 'PASS' : 'BLOCKED') : 'FAIL';
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, new_rows: added.length, smtp_acceptance: report.smtp_acceptance, message: report.message, configuration_preserved: report.configuration_preserved_excluding_test_proofs, profiles_preserved: report.profile_and_auth_records_preserved, delivery: report.delivery }));
  if (report.status === 'FAIL') process.exitCode = 1;
}
