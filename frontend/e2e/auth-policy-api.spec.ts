import { expect, test } from '@playwright/test';
import { adminClient, apiClient, mailFiles, readMail, registerFixture, sql } from '../../scripts/e2e/auth-fixtures.mjs';

test('isolated Docker policy controls persist, enforce roles and preserve password/OTP login', async ({ page }, info) => {
  test.setTimeout(180000); expect(info.project.use.baseURL).toBe('https://localhost:8444');
  const admin = await adminClient(), old = (await admin.call('/api/system/auth-policy/')).body;
  const protectedSql = "SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY key),'[]') FROM core_systemsetting s WHERE key IN ('smtp','smtp_draft','smtp_service_contact','smtp_service_automatic','mail_mode','mail_api','google_oauth')";
  const protectedConfig = sql(protectedSql), protectedSecrets = sql("SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY key),'[]') FROM core_systemsecret s");
  expect(old.enabled).toBe(false);
  try {
    const anonymous = apiClient();
    expect((await anonymous.call('/api/system/auth-policy/')).status).toBe(401);
    expect((await anonymous.call('/api/system/auth-policy/', 'PUT', { enabled: true, required_roles: ['alumno'] })).status).toBe(401);
    const student = await registerFixture('OTP-controls'), instructor = await registerFixture('OTP-controls-instructor');
    for (const f of [student, instructor]) {
      expect((await apiClient().call('/api/auth/verify-otp/', 'POST', { email: f.email, code: f.code })).status).toBe(200);
      expect((await admin.call(`/api/profiles/${f.id}/`, 'PATCH', { status: 'activo' })).status).toBe(200);
    }
    expect((await admin.call(`/api/profiles/${instructor.id}/`, 'PATCH', { role: 'instructor', roles: ['instructor'] })).status).toBe(200);
    await page.goto('/?auth=login'); await page.locator('#login-email').fill('e2e-admin@test.local');
    await page.locator('#login-password').fill(process.env.E2E_ADMIN_PASSWORD || 'E2eAdmin_2026!'); // pragma: allowlist secret - isolated fixture
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click(); await expect(page).toHaveURL(/\/admin$/);
    await page.getByRole('button', { name: 'Configuración', exact: true }).click();
    const open = async () => { await page.getByRole('button', { name: 'Seguridad', exact: true }).last().click(); await expect(page.getByRole('region', { name: 'Administración 2FA/OTP' }).getByRole('checkbox', { name: /^Activar 2FA/ })).toBeEnabled(); };
    await open(); const form = page.getByRole('region', { name: 'Administración 2FA/OTP' });
    for (const role of ['admin', 'instructor']) { const input = form.getByRole('checkbox', { name: role, exact: true }); if (await input.isChecked()) { await input.click(); await expect(input).not.toBeChecked(); } }
    if (!(await form.getByRole('checkbox', { name: 'alumno', exact: true }).isChecked())) await form.getByRole('checkbox', { name: 'alumno', exact: true }).click();
    await expect(form.getByRole('checkbox', { name: 'alumno', exact: true })).toBeChecked();
    await form.getByRole('checkbox', { name: /^Activar 2FA/ }).click();
    await expect(form.getByText('Política 2FA/OTP guardada correctamente.', { exact: true })).toBeVisible();
    expect((await admin.call('/api/system/auth-policy/')).body).toEqual({ enabled: true, required_roles: ['alumno'] });
    await page.reload(); await open(); await expect(form.getByRole('checkbox', { name: /^Activar 2FA/ })).toBeChecked();
    const client = apiClient(), before = new Set(mailFiles());
    expect((await client.call('/api/auth/login/', 'POST', { email: student.email, password: student.password })).status).toBe(202);
    const message = await readMail(student.email, before, 'temporal'), code = message.body.match(/\b\d{6}\b/)?.[0];
    expect(Boolean(code)).toBe(true);
    expect((await client.call('/api/auth/login/', 'POST', { email: student.email, password: student.password, code: code === '111111' ? '222222' : '111111' })).status).toBe(400);
    expect((await client.call('/api/auth/login/', 'POST', { email: student.email, password: student.password, code })).status).toBe(200);
    expect((await apiClient().call('/api/auth/login/', 'POST', { email: student.email, password: student.password, code })).status).toBe(400);
    const teacher = apiClient(); expect((await teacher.call('/api/auth/login/', 'POST', { email: instructor.email, password: instructor.password })).status).toBe(200);
    for (const denied of [client, teacher]) {
      expect((await denied.call('/api/system/auth-policy/')).status).toBe(403);
      expect((await denied.call('/api/system/auth-policy/', 'PUT', { enabled: false, required_roles: [] })).status).toBe(403);
    }
    expect((await admin.call('/api/system/auth-policy/', 'PUT', { enabled: true, required_roles: ['invalid-role'] })).status).toBe(400);
    expect((await admin.call('/api/system/auth-policy/')).body.enabled).toBe(true);
    await form.getByRole('checkbox', { name: /^Activar 2FA/ }).click(); await expect(form.getByRole('checkbox', { name: /^Activar 2FA/ })).not.toBeChecked();
    expect((await admin.call('/api/system/auth-policy/')).body.enabled).toBe(false);
    await page.reload(); await open(); await expect(form.getByRole('checkbox', { name: /^Activar 2FA/ })).not.toBeChecked();
    expect((await apiClient().call('/api/auth/login/', 'POST', { email: student.email, password: 'incorrect-synthetic-password' })).status).toBe(401);
    expect((await apiClient().call('/api/auth/login/', 'POST', { email: student.email, password: student.password })).status).toBe(200);
  } finally {
    expect((await admin.call('/api/system/auth-policy/', 'PUT', old)).status).toBe(200);
    expect(sql(protectedSql)).toBe(protectedConfig); expect(sql("SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY key),'[]') FROM core_systemsecret s")).toBe(protectedSecrets);
    await admin.call('/api/auth/logout/', 'POST', {});
  }
});
