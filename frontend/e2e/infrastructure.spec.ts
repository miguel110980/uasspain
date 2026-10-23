import { expect, test } from '@playwright/test';

test('removed initial configuration has no navigation or accessible page', async ({ page }, info) => {
  expect(info.project.use.baseURL).toBe('https://localhost:8444');
  const errors: string[] = [], infrastructureRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?auth=login');
  await page.getByLabel('Correo electrónico *', { exact: true }).fill('e2e-admin@test.local');
  await page.getByLabel('Contraseña *', { exact: true }).fill(process.env.E2E_ADMIN_PASSWORD || 'E2eAdmin_2026!'); // pragma: allowlist secret - isolated fixture
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  page.on('request', request => { if (/\/api\/infrastructure\//.test(request.url())) infrastructureRequests.push(request.url()); });
  for (const reload of [false, true]) {
    if (reload) await page.reload();
    else await page.goto('/admin?section=infraestructura-setup');
    await expect(page.locator('header h1')).toHaveText('Dashboard');
    await expect(page.locator('aside:visible').getByText('Infraestructura', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Configuración inicial', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Configuración inicial de infraestructura' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Pasos de configuración' })).toHaveCount(0);
  }
  await page.getByRole('textbox', { name: 'Buscar sección' }).fill('Configuración inicial');
  await expect(page.getByText('Sin resultados', { exact: true })).toBeVisible();
  expect(infrastructureRequests).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('removed-initial-configuration.png'), fullPage: true });
});
