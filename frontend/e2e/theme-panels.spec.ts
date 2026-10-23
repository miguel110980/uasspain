import { test, expect } from '@playwright/test';
import fixture from '../scripts/ui-fixtures.mjs';

// UI-only regression against the local build. These responses are synthetic:
// they never establish or modify sessions/accounts in the real backend.
for (const role of ['admin', 'instructor', 'alumno']) for (const saved of ['light', 'dark']) {
  test(`${role}: shared control, reload, navigation, logout/login and system preference (${saved})`, async ({ page, context }) => {
    const profile = fixture.profiles.find(profile => profile.role === role);
    let signedIn = true;
    await context.routeWebSocket('**/ws/**', socket => socket.onMessage(() => {}));
    await context.route(url => url.pathname.startsWith('/api/'), route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path === '/api/auth/logout/') signedIn = false;
      if (path === '/api/auth/login/') signedIn = true;
      if (path === '/api/auth/me/' || path === '/api/auth/login/') return route.fulfill({ json: signedIn ? { ...profile, session_role: role, full_name: 'Cuenta visual de prueba', profile } : null });
      if (path === '/api/system/status/') return route.fulfill({ json: fixture.status });
      if (path === '/api/profiles/') return route.fulfill({ json: fixture.profiles });
      if (path.startsWith('/api/profiles/')) return route.fulfill({ json: profile });
      if (path === '/api/public/content/versions/') return route.fulfill({ json: { services: '1', courses: '1', posts: '1' } });
      if (path === '/api/public/oauth/google/') return route.fulfill({ json: { enabled: false, client_id: '' } });
      return route.fulfill({ json: request.method() === 'GET' ? [] : { ok: true } });
    });
    await page.goto('/app.html');
    await page.evaluate(value => localStorage.setItem('theme', value), saved);
    const frames: string[] = [];
    await page.addInitScript(() => {
      (window as any).themeFrames = [];
      const sample = () => {
        if (document.body) (window as any).themeFrames.push(document.documentElement.className);
        if ((window as any).themeFrames.length < 120) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.emulateMedia({ colorScheme: saved === 'dark' ? 'light' : 'dark' });
    await page.goto('/' + role);
    await expect(page.locator('header h1')).toHaveText('Dashboard');
    await expect(page.locator('html')).toHaveClass(saved);
    frames.push(...await page.evaluate(() => (window as any).themeFrames));
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every(frame => frame === saved)).toBe(true);
    const next = saved === 'light' ? 'dark' : 'light';
    const toggle = page.getByRole('button', { name: next === 'dark' ? 'Activar tema oscuro' : 'Activar tema claro', exact: true });
    await page.keyboard.press('Tab'); await toggle.focus();
    expect(await toggle.evaluate(node => getComputedStyle(node).outlineStyle)).not.toBe('none');
    await toggle.press('Enter');
    await expect(page.locator('html')).toHaveClass(next);
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe(next);
    await page.reload(); await expect(page.locator('header h1')).toHaveText('Dashboard'); await expect(page.locator('html')).toHaveClass(next);
    await page.locator('aside:visible nav').getByRole('button', { name: role === 'admin' ? 'Mi cuenta' : role === 'instructor' ? 'Cuenta' : 'Mi cuenta', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(next);
    await page.locator('header').getByRole('button', { name: 'Menú de cuenta', exact: true }).click();
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await page.waitForURL(/\/$/); expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe(next);
    await page.goto('/?auth=login');
    const dialog = page.getByRole('dialog', { name: 'Cuenta UASSPAIN' });
    await dialog.locator('#login-email').fill(profile.email);
    await dialog.locator('#login-password').fill('synthetic-ui-input');
    await dialog.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.waitForURL(new RegExp('/' + role + '$'));
    await expect(page.locator('html')).toHaveClass(next);
    await expect(page.getByRole('button', { name: 'Usar tema del sistema', exact: true })).toHaveCount(0);
    // Retain coverage of the shared provider's saved system preference.
    await page.evaluate(() => localStorage.setItem('theme', 'system'));
    await page.reload();
    await expect(page.locator('header h1')).toHaveText('Dashboard');
    const system = saved === 'dark' ? 'light' : 'dark';
    await expect(page.locator('html')).toHaveClass(system);
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('system');
    await page.emulateMedia({ colorScheme: saved as 'light' | 'dark' }); await expect(page.locator('html')).toHaveClass(saved);
    await expect.poll(() => page.locator('html').evaluate(node => node.style.colorScheme)).toBe(saved);
    const tab = await context.newPage(); await tab.goto('/' + role);
    await expect(tab.locator('header h1')).toHaveText('Dashboard');
    await page.getByRole('button', { name: saved === 'light' ? 'Activar tema oscuro' : 'Activar tema claro', exact: true }).click();
    await expect(tab.locator('html')).toHaveClass(next);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await expect(page.locator('header').getByRole('group', { name: 'Tema de la aplicación' })).toBeVisible();
      await expect(page.locator('header').getByRole('group', { name: 'Tema de la aplicación' }).getByRole('button')).toHaveCount(1);
      await expect(page.locator('header').locator('svg.lucide-monitor')).toHaveCount(0);
    }
    await tab.close();
  });
}
