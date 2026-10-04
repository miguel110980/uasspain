import { test, expect } from '@playwright/test';

test('a gateway outage preserves the login form and retry reports a real password rejection', async ({ page }) => {
  let attempts = 0;
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/login/') {
      attempts++;
      if (attempts === 1) return route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad Gateway</html>' });
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Credenciales no válidas.' }) });
    }
    const body = path === '/api/auth/me/' ? null : path === '/api/public/oauth/google/' ? { configured: false, client_id: null } : path === '/api/public/stats/' ? {} : [];
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/?auth=login');
  await page.locator('#login-email').fill('login-test@example.invalid');
  await page.locator('#login-password').fill('Example_password_2026!');
  const submit = page.getByRole('button', { name: 'Iniciar sesión', exact: true });
  await submit.click();
  await expect(page.locator('#login-error')).toHaveText('Servicio temporalmente no disponible. Inténtalo de nuevo en unos instantes.');
  await expect(submit).toBeEnabled();
  await expect(page.locator('#login-email')).toHaveValue('login-test@example.invalid');
  await submit.click();
  await expect(page.locator('#login-error')).toHaveText('Credenciales no válidas.');
  expect(attempts).toBe(2);
});
