import { test, expect } from '@playwright/test';

const widths = [320, 360, 375, 390, 412, 480, 768, 820, 1024, 1280, 1366, 1440, 1920, 2560];

for (const width of widths) {
  test(`public pages, header and light theme at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const theme of ['dark', 'light']) {
      await page.addInitScript(value => localStorage.setItem('theme', value), theme);
      for (const route of ['/', '/formacion', '/contacto', '/servicios/termografia']) {
        await page.goto(route);
        await expect(page.locator('h1')).toBeVisible();
        await expect(page.locator('main')).toHaveCount(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), route).toBe(true);
        await expect(page.locator('[data-header-block]')).toHaveCount(3);
        const positions = await page.locator('[data-header-block]').evaluateAll(nodes => nodes.filter(node => getComputedStyle(node).display !== 'none').map(node => ({ left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right })));
        expect(positions.every((box, index) => box.left >= 0 && box.right <= width && (!index || positions[index - 1].right <= box.left + 1))).toBe(true);
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /index, follow/);
        if (theme === 'light') {
          expect(await page.locator('nav[aria-label="Navegación principal"]').evaluate(node => getComputedStyle(node).backdropFilter)).toBe('none');
          expect(await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(245, 247, 250)');
        }
      }
    }
    expect(errors).toEqual([]);
  });
}

for (const viewport of [{ width: 320, height: 480 }, { width: 390, height: 320 }, { width: 820, height: 375 }, { width: 1440, height: 320 }]) {
  test(`last menu item and keyboard access at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const mobile = viewport.width < 1440;
    if (mobile) await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
    await page.getByRole('button', { name: 'Formación', exact: true }).filter({ visible: true }).click();
    const menu = page.locator(mobile ? '#main-mobile-menu' : '[id^="desktop-menu-"]').filter({ visible: true });
    const last = menu.getByRole('link', { name: 'Formación Continua', exact: true });
    await last.focus();
    await expect(last).toBeInViewport();
    expect(await menu.evaluate(node => node.getBoundingClientRect().bottom <= innerHeight + 1)).toBe(true);
    if (mobile) {
      await menu.getByRole('link', { name: 'Contacto', exact: true }).focus();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Cerrar menú', exact: true })).toBeFocused();
    }
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    expect(await page.locator('body').evaluate(node => node.style.overflow)).not.toBe('hidden');
    if (mobile) await expect(page.getByRole('button', { name: 'Abrir menú', exact: true })).toBeFocused();
  });
}

test('login preserves password symbols, rejects duplicate submit and recovers from backend errors', async ({ page }) => {
  let requests = 0;
  const credential = ' Aa9<>{} &! '; // pragma: allowlist secret - synthetic fixture
  await page.route('**/api/auth/login/', async route => {
    requests++;
    expect(route.request().postDataJSON().password).toBe(credential);
    await new Promise(resolve => setTimeout(resolve, 250));
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Servicio temporalmente no disponible.' }) });
  });
  await page.goto('/?auth=login');
  const email = page.getByLabel('Correo electrónico *', { exact: true });
  await expect(email).toHaveAttribute('autocomplete', 'username');
  await expect(email).toHaveAttribute('autocapitalize', 'none');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.locator('#seo-org-jsonld')).toHaveCount(0);
  await email.fill('  User@EXAMPLE.COM ');
  await page.getByLabel('Contraseña *', { exact: true }).fill(credential);
  await page.getByRole('button', { name: 'Mostrar contraseña', exact: true }).click();
  await expect(page.getByLabel('Contraseña *', { exact: true })).toHaveAttribute('type', 'text');
  await page.locator('form').evaluate(form => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole('alert')).toHaveText('Servicio temporalmente no disponible.');
  expect(requests).toBe(1);
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

for (const email of ['E2E-ADMIN@TEST.LOCAL', 'E2e-Admin@Test.Local', '  e2e-admin@test.local  ']) {
  test(`login resolves the same account for ${email.trim()}`, async ({ page }) => {
    await page.goto('/?auth=login');
    await page.getByLabel('Correo electrónico *', { exact: true }).fill(email);
    await page.getByLabel('Contraseña *', { exact: true }).fill('E2eAdmin_2026!'); // pragma: allowlist secret - isolated fixture
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    const me = await page.request.get('/api/auth/me/', { headers: {
      'X-UASSpain-Window-Id': await page.evaluate(() => sessionStorage.getItem('uasspain.window_session_id') || ''),
    } });
    expect(me.ok()).toBe(true);
    expect((await me.json()).email).toBe('e2e-admin@test.local');
  });
}
