import { expect, test, type Page } from '@playwright/test';

// Frontend contract tests only. Signed exchange integration is tested separately.
async function fixture(page: Page, configured = false) {
  const state = { configured, configurationStatus: 200, starts: 0, startStatus: 503, refreshes: 0, scripts: 0, release: Promise.resolve() };
  await page.route('https://accounts.google.com/gsi/client', async route => { state.scripts++; await route.abort(); });
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const path = new URL(route.request().url()).pathname; let status = 200, body: unknown = [];
    if (path === '/api/public/oauth/google/') { await state.release; status = state.configurationStatus; body = { configured: state.configured, client_id: state.configured ? '1234-fixture.apps.googleusercontent.com' : null }; }
    else if (path === '/api/auth/google/oauth/start/') { state.starts++; status = state.startStatus; body = { detail: 'El servicio Google no está disponible. Use correo y contraseña.' }; }
    else if (path === '/api/auth/refresh/') { state.refreshes++; status = 401; body = { detail: 'Sin sesión.' }; }
    else if (path === '/api/auth/me/') { status = 401; body = { detail: 'Sin sesión.' }; }
    else if (path === '/api/auth/context/' || path === '/api/public/stats/' || path === '/api/public/content/versions/') body = {};
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  }); return state;
}
test('late Google configuration preserves typing and focus without loading an identity-token SDK', async ({ page }) => {
  const state = await fixture(page, true); let release!: () => void; state.release = new Promise<void>(resolve => { release = resolve; });
  await page.goto('/?auth=login'); const email = page.getByLabel('Correo electrónico *', { exact: true }), password = page.getByLabel('Contraseña *', { exact: true });
  await email.fill('typing@example.invalid'); await password.fill('SyntheticTyping_2026!'); release();
  await expect(page.getByRole('button', { name: 'Continuar con Google', exact: true })).toBeEnabled();
  await expect(email).toHaveValue('typing@example.invalid'); await expect(password).toHaveValue('SyntheticTyping_2026!'); await expect(password).toBeFocused();
  expect(state.starts).toBe(0); expect(state.scripts).toBe(0);
});
test('unverified configuration remains disabled and availability can be refreshed', async ({ page }) => {
  const state = await fixture(page); await page.goto('/?auth=login'); const button = page.getByRole('button', { name: 'Continuar con Google', exact: true });
  await expect(button).toBeDisabled(); await expect(page.getByText('Google no está activado', { exact: false })).toBeVisible();
  state.configured = true; await page.getByRole('button', { name: 'Comprobar disponibilidad' }).click(); await expect(button).toBeEnabled(); expect(state.starts).toBe(0);
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await expect(button).toBeVisible(); }
});
test('public configuration failure offers retry without losing conventional credentials', async ({ page }) => {
  const state = await fixture(page, true); state.configurationStatus = 503; await page.goto('/?auth=login');
  await expect(page.getByText('No se pudo comprobar Google', { exact: false })).toBeVisible(); state.configurationStatus = 200;
  await page.getByRole('button', { name: 'Comprobar disponibilidad' }).click(); await expect(page.getByRole('button', { name: 'Continuar con Google', exact: true })).toBeEnabled();
});
for (const status of [400, 401, 502, 503, 504]) test(`code start ${status} does not retry through refresh or block conventional login`, async ({ page }) => {
  const state = await fixture(page, true); state.startStatus = status; await page.goto('/?auth=login');
  const password = page.getByLabel('Contraseña *', { exact: true }); await password.fill('SyntheticTyping_2026!');
  const button = page.getByRole('button', { name: 'Continuar con Google', exact: true }); await expect(button).toBeEnabled();
  const refreshesBeforeGoogle = state.refreshes;
  await button.click(); await expect(page.getByRole('alert')).toContainText('Use correo y contraseña');
  await expect(button).toBeEnabled(); await expect(password).toHaveValue('SyntheticTyping_2026!'); expect(state.starts).toBe(1); expect(state.refreshes).toBe(refreshesBeforeGoogle);
});
