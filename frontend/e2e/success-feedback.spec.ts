import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fixture from '../scripts/ui-fixtures.mjs';

// Test visual feedback without writing accounts, backups, VPN or other operational data.
async function session(page: Page, role: 'admin' | 'instructor' | 'alumno' = 'admin') {
  const profile = { ...fixture.profiles.find(p => p.role === role), username: 'synthetic-user', fecha_nacimiento: '2000-01-01' };
  const requests: string[] = [];
  let failure = false;
  await page.context().routeWebSocket('**/ws/**', socket => socket.onMessage(() => {}));
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/api/auth/me/') return route.fulfill({ json: { ...profile, profile, session_role: role } });
    if (path === '/api/system/status/') return route.fulfill({ json: fixture.status });
    if (path.startsWith('/api/profiles/')) {
      if (request.method() !== 'GET') { requests.push(path); return route.fulfill({ status: failure ? 400 : 200, json: failure ? { detail: 'Error sintético al guardar.' } : { ...profile, ...request.postDataJSON() } }); }
      return route.fulfill({ json: path === '/api/profiles/' ? fixture.profiles : profile });
    }
    return route.fulfill({ json: request.method() === 'GET' ? [] : { ok: true } });
  });
  await page.goto(`/${role}`);
  await page.getByRole('button', { name: role === 'instructor' ? 'Cuenta' : 'Mi cuenta', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Guardar cambios', exact: true })).toBeVisible();
  return { requests, fail: () => { failure = true; } };
}
const success = (page: Page) => page.getByRole('status').filter({ hasText: 'Cambios guardados correctamente.' });
const save = (page: Page) => page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();

for (const role of ['admin', 'instructor', 'alumno'] as const) {
  test(`${role}: success follows confirmed save, expires and can be dismissed`, async ({ page }) => {
    const state = await session(page, role);
    await expect(success(page)).toHaveCount(0);
    await page.clock.install(); await save(page);
    await expect(success(page)).toBeVisible(); expect(state.requests).toHaveLength(1);
    await page.clock.fastForward(4000); await expect(success(page)).toBeVisible();
    await page.clock.fastForward(1500); await expect(success(page)).toHaveCount(0);
    await save(page); await expect(success(page)).toBeVisible();
    await success(page).getByRole('button', { name: 'Cerrar mensaje de éxito' }).click();
    await expect(success(page)).toHaveCount(0);
    await save(page); await expect(success(page)).toBeVisible();
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('button', { name: role === 'instructor' ? 'Cuenta' : 'Mi cuenta', exact: true }).click();
    await expect(success(page)).toHaveCount(0);
    await save(page); await expect(success(page)).toBeVisible(); await page.reload();
    await page.getByRole('button', { name: role === 'instructor' ? 'Cuenta' : 'Mi cuenta', exact: true }).click();
    await expect(success(page)).toHaveCount(0);
  });
}

test('success remains readable during keyboard focus and repeated saves receive a new lifetime', async ({ page }) => {
  await session(page); await page.clock.install(); await save(page);
  const close = success(page).getByRole('button', { name: 'Cerrar mensaje de éxito' });
  await close.focus(); await page.clock.fastForward(10000); await expect(success(page)).toBeVisible();
  await page.keyboard.press('Enter'); await expect(success(page)).toHaveCount(0);
  await save(page); await page.clock.fastForward(4000); await save(page);
  await page.clock.fastForward(2000); await expect(success(page)).toBeVisible();
  await page.clock.fastForward(3100); await expect(success(page)).toHaveCount(0);
});

test('failed actions never show success and errors are not timed out', async ({ page }) => {
  const state = await session(page); state.fail(); await page.clock.install(); await save(page);
  await expect(page.getByText('Error al guardar los cambios.', { exact: true })).toBeVisible();
  await page.clock.fastForward(10000); await expect(success(page)).toHaveCount(0);
  await expect(page.getByText('Error al guardar los cambios.', { exact: true })).toBeVisible();
});

test('success is accessible and fits both themes at mobile, tablet and desktop widths', async ({ page }) => {
  await session(page);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(t => { localStorage.setItem('theme', t); window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: t, storageArea: localStorage })); }, theme);
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 }); await save(page);
      await expect(success(page)).toBeVisible(); await expect(success(page)).toHaveAttribute('aria-live', 'polite');
      const box = await success(page).boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      expect((await new AxeBuilder({ page }).include('[role="status"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
      await success(page).getByRole('button', { name: 'Cerrar mensaje de éxito' }).click();
    }
  }
});

for (const mode of ['expire', 'close', 'navigate', 'hash'] as const) {
  test(`global success toast: ${mode} leaves no stale message`, async ({ page }) => {
    await page.context().routeWebSocket('**/ws/**', socket => socket.onMessage(() => {}));
    await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ status: new URL(route.request().url()).pathname === '/api/auth/me/' ? 401 : 200, json: [] }));
    await page.goto('/'); await page.clock.install();
    await page.evaluate(() => sessionStorage.setItem('uasspain.auth_notice', 'Operación sintética completada.'));
    await page.goto('/?account=deactivated');
    const notice = page.getByRole('status').filter({ hasText: 'Cuenta dada de baja' });
    await expect(notice).toBeVisible();
    if (mode === 'expire') { await page.clock.fastForward(1000); await expect(notice).toBeVisible(); await page.clock.fastForward(4500); }
    if (mode === 'close') await notice.getByRole('button', { name: 'Cerrar notificación' }).click();
    if (mode === 'navigate') {
      const menu = page.getByRole('button', { name: 'Abrir menú', exact: true });
      if (await menu.isVisible()) await menu.click();
      await page.getByRole('link', { name: 'Quiénes Somos', exact: true }).first().click();
    }
    if (mode === 'hash') await page.evaluate(() => { window.location.hash = 'servicios'; });
    await expect(notice).toHaveCount(0, { timeout: 1000 }); await page.reload(); await expect(notice).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem('uasspain.auth_notice'))).toBeNull();
  });
}

test('global success toast remains accessible and responsive in both themes', async ({ page }) => {
  await page.context().routeWebSocket('**/ws/**', socket => socket.onMessage(() => {}));
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ status: new URL(route.request().url()).pathname === '/api/auth/me/' ? 401 : 200, json: [] }));
  await page.goto('/');
  for (const theme of ['light', 'dark']) for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(t => { localStorage.setItem('theme', t); sessionStorage.setItem('uasspain.auth_notice', 'Operación sintética completada.'); }, theme);
    await page.goto('/?account=deactivated');
    const notice = page.getByRole('status').filter({ hasText: 'Cuenta dada de baja' }); await expect(notice).toBeVisible();
    const box = await notice.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    expect((await new AxeBuilder({ page }).include('[role="status"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    await notice.getByRole('button', { name: 'Cerrar notificación' }).click();
  }
});
