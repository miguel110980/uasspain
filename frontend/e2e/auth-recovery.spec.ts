import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { apiClient, check, mailFiles, readMail, registerFixture, resetPayload, sql } from '../../scripts/e2e/auth-fixtures.mjs';

test('password recovery survives an error, retries and returns a neutral answer through the frontend proxy', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let requests = 0;
  await page.route('**/api/auth/password-reset/', async route => {
    requests++;
    if (requests === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Servicio temporalmente no disponible.' }) });
    } else await route.continue();
  });
  await page.goto('/?auth=login');
  await page.getByRole('button', { name: /olvid.*contrase/i }).click();
  const email = page.getByLabel('Correo electrónico *', { exact: true });
  await expect(email).toHaveAttribute('autocomplete', 'username');
  await email.fill(' UNKNOWN-RECOVERY@Test.Local ');
  await email.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('Servicio temporalmente no disponible.');
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Obtener enlace', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Si existe una cuenta asociada a ese correo, recibirás un enlace para restablecer tu contraseña.');
  expect(requests).toBe(2);
  expect(errors).toEqual([]);
});

test('a generated recovery link changes an isolated password in the UI, rejects replay and revokes its session', async ({ page }) => {
  const fixture = await registerFixture();
  try {
    const client = apiClient();
    check((await client.call('/api/auth/verify-otp/', 'POST', { email: fixture.email, code: fixture.code })).status === 200, 'Browser fixture verification');
    sql(`UPDATE accounts_userprofile SET status='activo' WHERE id='${fixture.id}'`);
    check((await client.call('/api/auth/login/', 'POST', { email: fixture.email, password: fixture.password })).status === 200, 'Browser fixture old login');
    const before = new Set(mailFiles());
    await client.call('/api/auth/password-reset/', 'POST', { email: fixture.email });
    const message = await readMail(fixture.email, before, 'Restablecer');
    const password = `Bb9!${randomBytes(18).toString('hex')}`;
    const form = resetPayload(message, password);
    const query = new URLSearchParams({ uid: form.get('uid')!, token: form.get('token')! });
    await page.goto(`/restablecer-contrasena?${query}`);
    await page.getByLabel('Nueva contraseña', { exact: true }).fill(password);
    await page.getByLabel('Confirmar contraseña', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Guardar contraseña', exact: true }).click();
    await expect(page.getByText(/contraseña.*actualizada/i)).toBeVisible();
    check((await client.call('/api/auth/me/')).status === 401, 'Browser reset session revocation');
    await page.goto(`/restablecer-contrasena?${query}`);
    await page.getByLabel('Nueva contraseña', { exact: true }).fill(password);
    await page.getByLabel('Confirmar contraseña', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Guardar contraseña', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(/invalido|expirado/i);
    await page.goto('/?auth=login');
    await page.getByLabel('Correo electrónico *', { exact: true }).fill(fixture.email);
    await page.getByLabel('Contraseña *', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await expect(page).toHaveURL(/\/alumno$/);
  } finally {
    sql(`DELETE FROM accounts_userprofile WHERE id='${fixture.id}'; DELETE FROM auth_user WHERE id=${Number(fixture.userId)};`);
    fixture.password = ''; fixture.code = '';
  }
});

for (const width of [320, 360, 375, 390, 412, 480, 768, 820, 1024, 1280, 1440, 1920]) {
  test(`login and recovery remain accessible at ${width}px in both themes`, async ({ page }) => {
    await page.setViewportSize({ width, height: 480 });
    for (const theme of ['dark', 'light']) {
      await page.addInitScript(theme => localStorage.setItem('theme', theme), theme);
      await page.goto('/?auth=login');
      await page.reload();
      expect(await page.locator('html').evaluate(node => node.classList.contains('dark'))).toBe(theme === 'dark');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const input = page.getByLabel('Correo electrónico *', { exact: true });
      const contrast = await input.evaluate(node => {
        const style = getComputedStyle(node);
        const context = document.createElement('canvas').getContext('2d')!;
        const luminance = (color: string) => {
          context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
          const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        const foreground = luminance(style.color), background = luminance(style.backgroundColor);
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      });
      expect(contrast).toBeGreaterThanOrEqual(4.5);
      await input.focus();
      await page.keyboard.press('Shift+Tab');
      expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
      await page.getByRole('button', { name: /olvid.*contrase/i }).click();
      await expect(page.getByRole('heading', { name: 'Recuperar contraseña', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Obtener enlace', exact: true })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const submit = page.getByRole('button', { name: 'Obtener enlace', exact: true });
      await submit.scrollIntoViewIfNeeded();
      const box = await submit.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= width).toBeTruthy();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    }
  });
}
