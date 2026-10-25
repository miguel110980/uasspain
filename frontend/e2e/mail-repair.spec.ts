import { expect, test, type Page } from '@playwright/test';
import fixture from '../scripts/ui-fixtures.mjs';

// Host-build UI contract tests. Every API/WebSocket is intercepted: no real
// account, provider request, queue, database or email is touched.
async function mailFixture(page: Page, confirmed = false, pendingSmtp = false) {
  const profile = fixture.profiles.find(p => p.role === 'admin');
  const state = { confirmed, name: 'Saved corporate identity', key: true, calls: [] as { path: string; method: string }[], testStatus: 200, providerVerified: false, monitorReads: 0, smtpPending: pendingSmtp, smtpReady: false };
  const config = () => ({ provider: 'postmark', from_email: 'no-reply@uasspain.com', from_name: state.name, contact_recipient: 'info@uasspain.com', sender_panel_confirmed: state.confirmed });
  const message = { id: '10000000-0000-4000-8000-000000000001', message_type: 'provider_test', provider: 'postmark', state: 'FAILED', attempts: 1, created_at: '2026-10-25T10:00:00Z', last_error: 'account_pending_approval', provider_latency_ms: 42 };
  await page.context().routeWebSocket('**/ws/**', socket => socket.onMessage(() => {}));
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    state.calls.push({ path, method });
    if (path === '/api/auth/me/') return route.fulfill({ json: { ...profile, session_role: 'admin', profile } });
    if (path === '/api/system/status/') return route.fulfill({ json: fixture.status });
    if (path === '/api/profiles/') return route.fulfill({ json: fixture.profiles });
    if (path === '/api/system/mail/') {
      if (method === 'PUT') { const payload = request.postDataJSON(); state.confirmed = payload.config.sender_panel_confirmed; state.name = payload.config.from_name; if (payload.api_key) state.key = true; }
      return route.fulfill({ json: { api_exclusive: false, channel_ready: false, config: config(), key_configured: state.key, sender_status: state.confirmed ? 'PENDING_VERIFICATION' : 'UNCONFIRMED', provider_verified: state.providerVerified, activation_ready: false } });
    }
    if (path === '/api/system/mail/monitor/') {
      state.monitorReads++;
      return route.fulfill({ json: { channel: 'smtp', counts: { FAILED: 17, PENDING: 3 }, alerts: ['account_pending_approval'], circuits: [{ provider: 'postmark', state: 'OPEN', failures: 17 }], migration: { state: 'API_CONFIGURED', last_passed: 'API_CONFIGURED' }, transitions: [], messages: [message] } });
    }
    if (path === '/api/system/smtp/') {
      if (method === 'PUT' && state.smtpReady) state.smtpPending = false;
      return route.fulfill({ json: { enabled: true, host: 'saved-smtp.example.invalid', port: 587, security: 'STARTTLS', username: 'fixture@example.invalid', from_email: 'fixture@example.invalid', configured: true, password_configured: true, pending_verification: state.smtpPending, ready_to_activate: state.smtpReady } });
    }
    if (path === '/api/system/smtp/test/') { state.smtpReady = true; return route.fulfill({ json: { ok: true, detail: 'Prueba SMTP simulada aceptada.' } }); }
    if (path === '/api/system/mail/test/') return route.fulfill({ status: state.testStatus, json: { ok: state.testStatus === 200, provider_code: 'account_pending_approval', detail: state.testStatus === 200 ? 'Prueba simulada aceptada; recepción no verificada.' : 'La cuenta Postmark está pendiente de aprobación.' } });
    return route.fulfill({ json: method === 'GET' ? [] : { ok: true } });
  });
  await page.goto('/admin?section=configuracion');
  await page.getByRole('button', { name: 'SMTP / Correo', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'SMTP', exact: true })).toBeChecked();
  const api = page.getByRole('form', { name: 'Configuración API de correo', exact: true });
  await api.getByRole('radio', { name: 'API — Postmark', exact: true }).check();
  return { state, api };
}

test('saved values win over defaults and persist through save and reload', async ({ page }) => {
  const { api } = await mailFixture(page);
  await expect(api.getByLabel('Nombre remitente API', { exact: true })).toHaveValue('Saved corporate identity');
  await expect(api.getByLabel('Nombre remitente API', { exact: true })).toHaveAttribute('readonly');
  await api.getByLabel('He comprobado en el panel de Postmark', { exact: false }).check();
  await api.getByRole('button', { name: 'Guardar canal y configuración', exact: true }).click();
  await expect(api).toContainText('Configuración API guardada sin activar');
  await page.reload();
  await page.getByRole('button', { name: 'SMTP / Correo', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'SMTP', exact: true })).toBeChecked();
  await expect(api.getByLabel('Nombre remitente API', { exact: true })).toHaveValue('Saved corporate identity');
});

test('local confirmation and candidate key cannot enable a test until saved', async ({ page }) => {
  const { state, api } = await mailFixture(page);
  await api.getByLabel('Destinatario de prueba API', { exact: true }).fill('authorized@example.invalid');
  await api.getByLabel('Autorizo enviar una prueba a este destinatario.', { exact: true }).check();
  const send = api.getByRole('button', { name: 'Enviar correo de prueba API', exact: true });
  await expect(send).toBeDisabled();
  await api.getByLabel('He comprobado en el panel de Postmark', { exact: false }).check();
  await expect(api).toContainText('Cambios API sin guardar');
  await expect(send).toBeDisabled();
  expect(state.calls.filter(c => c.path.endsWith('/test/'))).toEqual([]);
  await api.getByRole('button', { name: 'Guardar canal y configuración', exact: true }).click();
  await expect(send).toBeEnabled();
  await api.getByLabel('API Key', { exact: true }).fill('synthetic-candidate-not-a-real-token');
  await expect(send).toBeDisabled();
  await api.getByRole('button', { name: 'Guardar canal y configuración', exact: true }).click();
  await expect(api.getByLabel('API Key', { exact: true })).toHaveValue('');
  await expect(send).toBeEnabled();
});

test('clearing last messages needs confirmation and changes only the visual table', async ({ page }) => {
  const { state } = await mailFixture(page);
  const table = page.getByRole('table');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  const before = state.calls.length;
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Limpiar últimos envíos', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Limpiar últimos envíos', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Monitorización de correo' })).toContainText('Fallidos: 17');
  await expect(page.getByRole('region', { name: 'Monitorización de correo' })).toContainText('Pendientes: 3');
  expect(state.calls.slice(before).filter(c => c.method !== 'GET')).toEqual([]);
  const reads = state.monitorReads;
  await page.getByRole('button', { name: 'Actualizar correo', exact: true }).click();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  expect(state.monitorReads).toBeGreaterThan(reads);
});

test('provider approval errors remain visible and do not change the selected saved channel', async ({ page }) => {
  const { state, api } = await mailFixture(page, true);
  state.testStatus = 503;
  await api.getByLabel('Destinatario de prueba API', { exact: true }).fill('authorized@example.invalid');
  await api.getByLabel('Autorizo enviar una prueba a este destinatario.', { exact: true }).check();
  await api.getByRole('button', { name: 'Enviar correo de prueba API', exact: true }).click();
  await expect(api).toContainText('La cuenta Postmark está pendiente de aprobación.');
  await expect(api).toContainText('Canal guardado: SMTP');
  expect(state.calls.filter(c => c.method === 'POST' && c.path === '/api/system/smtp/test/')).toEqual([]);
});

test('SMTP draft is distinguished from the working channel and requires save after a simulated test', async ({ page }) => {
  const { state } = await mailFixture(page, false, true);
  await page.getByRole('radio', { name: 'SMTP', exact: true }).check();
  const smtp = page.getByRole('form', { name: 'Configuración SMTP', exact: true });
  await expect(smtp).toContainText('La configuración operativa y el 2FA no se han sustituido.');
  await smtp.getByRole('button', { name: 'Guardar configuración', exact: true }).click();
  await expect(smtp).toContainText('Borrador SMTP guardado.');
  await smtp.getByLabel('Destinatario de prueba', { exact: true }).fill('authorized@example.invalid');
  await smtp.getByRole('button', { name: 'Enviar correo de prueba', exact: true }).click();
  await expect(smtp).toContainText('Prueba vigente; vuelva a guardar para aplicar.');
  expect(state.smtpPending).toBe(true);
  await smtp.getByRole('button', { name: 'Guardar configuración', exact: true }).click();
  await expect(smtp.getByRole('status')).toHaveText('Configuración guardada.');
  expect(state.smtpPending).toBe(false);
  expect(state.calls.filter(c => c.path === '/api/system/mail/test/')).toEqual([]);
});
