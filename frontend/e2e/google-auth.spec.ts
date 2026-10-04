import { test, expect, type Page } from '@playwright/test';

// Provider responses are simulated in the browser only; no real backend session is issued.
async function googleFixture(page: Page, options: { configured?: boolean; configurationStatus?: number; challengeFails?: boolean; scriptFails?: boolean; loginStatus?: number } = {}) {
  const state = { configured: true, configurationStatus: 200, challengeFails: false, scriptFails: false, loginStatus: 200, authenticated: false, challenges: 0, logins: 0, refreshes: 0, scripts: 0, ...options };
  await page.route('https://accounts.google.com/gsi/client**', async route => {
    state.scripts++;
    if (state.scriptFails) return route.abort();
    await route.fulfill({ contentType: 'text/javascript', body: `
      let config;
      window.google = { accounts: { id: {
        initialize(value) { config = value; },
        renderButton(container, options) {
          container.replaceChildren();
          const button = document.createElement('button');
          button.type = 'button'; button.textContent = 'Continuar con Google';
          button.style.width = options.width + 'px'; button.style.height = '40px';
          button.dataset.nonce = config.nonce;
          button.onclick = () => config.callback({ credential: 'synthetic-google-token' });
          container.appendChild(button);
        }, cancel() {}, disableAutoSelect() {}
      } } };
    ` });
  });
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const path = new URL(route.request().url()).pathname;
    let status = 200;
    let body: unknown = [];
    if (path === '/api/public/oauth/google/') {
      status = state.configurationStatus;
      body = status === 200
        ? { configured: state.configured, client_id: state.configured ? '123-test.apps.googleusercontent.com' : null }
        : { code: 'service_unavailable', detail: 'Servicio temporalmente no disponible.' };
    }
    else if (path === '/api/auth/google/challenge/') {
      state.challenges++;
      status = state.challengeFails ? 503 : 200;
      body = status === 200 ? { nonce: `nonce-${state.challenges}` } : { detail: 'No disponible.' };
    } else if (path === '/api/auth/google/') {
      state.logins++;
      expect(route.request().postDataJSON().id_token).toBe('synthetic-google-token');
      status = state.loginStatus;
      state.authenticated = status === 200;
      body = status === 404 ? { code: 'not_found', detail: 'Recurso no encontrado.' }
        : status === 401 ? { code: 'not_authenticated', detail: 'Credenciales no válidas.' }
          : status >= 500 ? { code: 'service_unavailable', detail: 'Servicio temporalmente no disponible.' }
            : { detail: 'Acceso correcto.' };
    } else if (path === '/api/auth/me/') {
      status = state.authenticated ? 200 : 401;
      body = state.authenticated ? { id: 'fixture', email: 'instructor@test.invalid', role: 'instructor', roles: ['instructor'], session_role: 'instructor', profile: { id: 'fixture', role: 'instructor', status: 'activo' } } : { detail: 'Sin sesión.' };
    } else if (path === '/api/auth/refresh/') { state.refreshes++; status = 401; body = { detail: 'Sin sesión.' }; }
    else if (path === '/api/public/stats/') body = {};
    else if (path === '/api/system/status/') body = {};
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return state;
}

test('Google remains visible without configuration and can recover after configuration', async ({ page }) => {
  const state = await googleFixture(page, { configured: false });
  await page.goto('/?auth=login');
  await expect(page.getByRole('button', { name: 'Continuar con Google', exact: true })).toBeDisabled();
  await expect(page.getByText('Google no está activado en esta instalación.', { exact: false })).toBeVisible();
  await expect(page.getByText('El administrador debe configurarlo en Configuración → Integraciones.', { exact: false })).toBeVisible();
  expect(state.scripts).toBe(0); expect(state.challenges).toBe(0);
  state.configured = true;
  await page.getByRole('button', { name: 'Comprobar disponibilidad' }).click();
  const button = page.getByRole('button', { name: 'Continuar con Google', exact: true });
  await expect(button).toBeEnabled(); await expect(button).toHaveAttribute('data-nonce', 'nonce-1');
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(button).toBeVisible();
  }
  await button.focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/instructor$/);
  expect(state.logins).toBe(1);
});

test('nonce failures and missing accounts recover with a fresh attempt', async ({ page }) => {
  const state = await googleFixture(page, { challengeFails: true, loginStatus: 404 });
  await page.goto('/?auth=login');
  await expect(page.getByText('No se pudo preparar el acceso con Google.')).toBeVisible();
  state.challengeFails = false;
  await page.getByRole('button', { name: 'Reintentar Google' }).click();
  const button = page.getByRole('button', { name: 'Continuar con Google', exact: true });
  await expect(button).toHaveAttribute('data-nonce', 'nonce-2');
  await button.click();
  await expect(page.getByRole('alert')).toContainText('No hay cuenta UASSPAIN');
  await expect(button).toHaveAttribute('data-nonce', 'nonce-3');
  state.loginStatus = 200;
  await button.click(); await expect(page).toHaveURL(/\/instructor$/);
  expect(state.logins).toBe(2);
});

test('invalid Google tokens are not retried through session refresh', async ({ page }) => {
  const state = await googleFixture(page, { loginStatus: 401 });
  await page.goto('/?auth=login');
  const button = page.getByRole('button', { name: 'Continuar con Google', exact: true });
  await expect(button).toHaveAttribute('data-nonce', 'nonce-1');
  const refreshes = state.refreshes;
  await button.click(); await expect(page.getByRole('alert')).toContainText('Credenciales no válidas.');
  await expect(button).toHaveAttribute('data-nonce', 'nonce-2');
  expect(state.refreshes).toBe(refreshes); expect(state.logins).toBe(1);
});

test('Google configuration service failures are distinguished and recover without loading the SDK early', async ({ page }) => {
  const state = await googleFixture(page, { configurationStatus: 503 });
  await page.goto('/?auth=login');
  await expect(page.getByText('No se pudo comprobar Google porque el servicio de acceso no está disponible.', { exact: false })).toBeVisible();
  await expect(page.getByText('Google no está activado en esta instalación.', { exact: false })).toHaveCount(0);
  await expect(page.getByText('No se pudo cargar Google en este navegador.', { exact: false })).toHaveCount(0);
  expect(state.scripts).toBe(0); expect(state.challenges).toBe(0);
  state.configurationStatus = 200;
  await page.getByRole('button', { name: 'Comprobar disponibilidad' }).click();
  await expect(page.getByRole('button', { name: 'Continuar con Google', exact: true })).toBeEnabled();
  expect(state.scripts).toBe(1); expect(state.challenges).toBe(1);
});

for (const status of [502, 503, 504]) {
  test(`Google login service ${status} failures allow a fresh attempt without blaming credentials`, async ({ page }) => {
    const state = await googleFixture(page, { loginStatus: status });
    await page.goto('/?auth=login');
    const button = page.getByRole('button', { name: 'Continuar con Google', exact: true });
    await expect(button).toHaveAttribute('data-nonce', 'nonce-1');
    await button.click();
    await expect(page.getByRole('alert')).toContainText('El servicio de acceso con Google está temporalmente no disponible.');
    await expect(page.getByRole('alert')).not.toContainText('Credenciales incorrectas');
    await expect(button).toHaveAttribute('data-nonce', 'nonce-2');
    expect(state.logins).toBe(1);
    state.loginStatus = 200;
    await button.click();
    await expect(page).toHaveURL(/\/instructor$/);
    expect(state.logins).toBe(2);
  });
}

test('Google SDK loading failure offers a working retry', async ({ page }) => {
  const state = await googleFixture(page, { scriptFails: true });
  await page.goto('/?auth=login');
  await expect(page.getByText('No se pudo cargar Google en este navegador.', { exact: false })).toBeVisible();
  await expect(page.getByText('No se pudo comprobar Google porque el servicio de acceso no está disponible.', { exact: false })).toHaveCount(0);
  state.scriptFails = false;
  await page.getByRole('button', { name: 'Comprobar disponibilidad' }).click();
  await expect(page.getByRole('button', { name: 'Continuar con Google', exact: true })).toBeEnabled();
  expect(state.scripts).toBe(2);
});
