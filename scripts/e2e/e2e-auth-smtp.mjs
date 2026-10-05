import { adminClient, apiClient, check, sql } from './auth-fixtures.mjs';

let passed = 0;
const gate = (condition, name) => { check(condition, name); passed++; console.log(`PASS | auth_smtp_${name}`); };
let admin;
const student = apiClient();
const credentials = { email: 'alumno.e2e@test.local', password: 'E2ePass_2026!' }; // isolated fixture
let id;
try {
  admin = await adminClient();
  gate((await student.call('/api/auth/login/', 'POST', credentials)).status === 200, 'password_login_without_email');
  id = (await student.call('/api/auth/me/')).body.id;
  check(/^[0-9a-f-]{36}$/.test(id), 'Isolated student UUID');
  const policy = await admin.call('/api/system/auth-policy/', 'PUT', { enabled: true, required_roles: ['alumno'] });
  gate(policy.status === 400 && policy.body.code === 'validation_error', 'activation_without_smtp_rejected');
  gate((await admin.call('/api/system/auth-policy/')).body.enabled === false, 'rejected_policy_not_persisted');
  const override = await admin.call(`/api/profiles/${id}/`, 'PATCH', { login_2fa_enabled_override: true });
  gate(override.status === 400 && override.body.code === 'validation_error', 'override_without_smtp_rejected');
  gate(sql(`SELECT login_2fa_enabled_override IS NULL FROM accounts_userprofile WHERE id='${id}'`) === 't', 'rejected_override_not_persisted');
  const config = { enabled: true, host: 'localhost', port: 1, security: 'STARTTLS', username: 'fixture', from_email: 'fixture@test.local', timeout_seconds: 1, password: 'isolated-smtp-fixture' };
  const invalidHost = await admin.call('/api/system/smtp/', 'PUT', { ...config, host: 'mail..example.invalid' });
  gate(invalidHost.status === 400 && invalidHost.body.code === 'validation_error', 'malformed_smtp_host_rejected');
  gate((await admin.call('/api/system/smtp/', 'PUT', config)).status === 200, 'transport_failure_fixture_configured');
  gate((await admin.call('/api/system/auth-policy/', 'PUT', { enabled: true, required_roles: ['alumno'] })).status === 200, 'development_configured_transport_gate');
  const disabled = await admin.call('/api/system/smtp/', 'PUT', { ...config, enabled: false });
  gate(disabled.status === 400, 'active_policy_prevents_disabling_smtp');
  const failure = await student.call('/api/auth/login/', 'POST', credentials);
  gate(failure.status === 503 && failure.body.code === 'otp_delivery_unavailable' && typeof failure.body.correlation_id === 'string', 'delivery_failure_explicit');
  gate(sql(`SELECT login_otp_hash='' AND login_otp_created_at IS NULL AND login_otp_attempts=0 FROM accounts_userprofile WHERE id='${id}'`) === 't', 'delivery_failure_complete_rollback');
  const retry = await student.call('/api/auth/login/', 'POST', credentials);
  gate(retry.status === 503 && retry.body.code === 'otp_delivery_unavailable', 'failed_delivery_has_no_false_cooldown');
  gate((await student.call('/api/auth/me/')).status === 200, 'failed_delivery_preserves_existing_session');
  const probe = await admin.call('/api/system/smtp/test/', 'POST', { recipient: 'fixture@test.local' });
  gate(probe.status === 503 && (await admin.call('/api/system/smtp/')).body.last_test_ok === false, 'transport_test_records_failure');
  console.log(`AUTH_SMTP_E2E=${passed}/${passed} PASS; SMTP_TRANSPORT=BLOCKED (no external credentials)`);
} catch (error) {
  console.error(`AUTH_SMTP_E2E=FAIL; gate=${error.message.split('\n')[0]}`);
  process.exitCode = 1;
} finally {
  if (admin) {
    check((await admin.call('/api/system/auth-policy/', 'PUT', { enabled: false, required_roles: [] })).status === 200, 'SMTP policy cleanup');
    sql("DELETE FROM core_systemsetting WHERE key='smtp'; DELETE FROM core_systemsecret WHERE key='smtp_password';");
  }
}
