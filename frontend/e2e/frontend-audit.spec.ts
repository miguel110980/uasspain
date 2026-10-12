import { expect, test } from '@playwright/test';
import fixture from '../scripts/ui-fixtures.mjs';

async function mockPanel(page, role, state) {
  const me = fixture.profiles.find(profile => profile.role === role);
  await page.routeWebSocket('**/ws/**', ws => ws.onMessage(() => {}));
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/api/auth/me/') return route.fulfill({ json: { ...me, profile: me, session_role: role } });
    if (route.request().method() !== 'GET') return route.fulfill({ json: {} });
    if (state.failed) return route.fulfill({ status: 503, json: { detail: 'Fallo de prueba' } });
    let data = [];
    if (p === '/api/system/status/') data = fixture.status;
    else if (p === '/api/profiles/') data = fixture.profiles;
    else if (p === '/api/system/auth-policy/') data = fixture.status.two_factor;
    return route.fulfill({ json: data });
  });
}

test('drawer and account popover preserve focus across a desktop resize', async ({ page }) => {
  await mockPanel(page, 'admin', { failed: false });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/admin');
  const trigger = page.locator('header').getByRole('button', { name: 'Abrir menú', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Menú del panel' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.setViewportSize({ width: 1440, height: 900 });
  const account = page.getByRole('button', { name: 'Menú de cuenta' });
  await account.click();
  const accountDialog = page.getByRole('dialog', { name: 'Menú de cuenta' });
  await expect(accountDialog.getByRole('button', { name: 'Mi cuenta', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(accountDialog.getByRole('button', { name: 'Cerrar sesión', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(account).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Menú del panel' })).toHaveCount(0);
});

const sections = {
  admin: ['Actividad en tiempo real', 'Estadísticas', 'Conexiones en vivo', 'Registro de Conexiones', 'Seguridad', 'Auditoría', 'Monitorización', 'Notificaciones', 'Instructores'],
  instructor: ['Exámenes', 'Material', 'Resultados', 'Estadísticas'],
  alumno: ['Resultados', 'Evolución', 'Material'],
};
for (const [role, labels] of Object.entries(sections)) for (const label of labels) {
  test(`${role} ${label}: a failed load is distinct from empty data and can recover`, async ({ page }) => {
    const state = { failed: true }, errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await mockPanel(page, role, state);
    await page.goto('/' + role);
    await page.locator('aside:visible nav').getByRole('button', { name: label, exact: true }).click();
    const alert = page.locator('main').getByRole('alert').first();
    await expect(alert).toBeVisible();
    state.failed = false;
    await alert.getByRole('button', { name: 'Reintentar', exact: true }).click();
    await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('blog shows loading, failure, retry and then an empty response', async ({ page }) => {
  let failed = true;
  let release;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const p = new URL(route.request().url()).pathname;
    if (p.includes('blog')) {
      await waiting;
      return route.fulfill({ status: failed ? 503 : 200, json: failed ? { detail: 'Fallo de prueba' } : [] });
    }
    return route.fulfill({ status: p.includes('/auth/') ? 401 : 200, json: [] });
  });
  await page.goto('/blog');
  await expect(page.getByRole('status', { name: 'Cargando publicaciones' })).toBeVisible();
  release();
  await expect(page.getByRole('alert')).toBeVisible();
  failed = false;
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByText('No hay publicaciones disponibles todavía.')).toBeVisible();
});

test('courses with the same name retain their own links without React key warnings', async ({ page }) => {
  const warnings = [];
  page.on('console', message => { if (/same key|unique.*key/i.test(message.text())) warnings.push(message.text()); });
  const courses = fixture.courses.slice(0, 2).map(course => ({ ...course, name: 'Curso repetido', category: 'other', status: 'published' }));
  await page.route(url => url.pathname.startsWith('/api/'), route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/courses') return route.fulfill({ json: courses });
    if (url.pathname === '/api/auth/me/' && url.searchParams.get('optional') === 'true') return route.fulfill({ json: null });
    if (url.pathname === '/api/public/content/versions/') return route.fulfill({ json: { services:'1',posts:'1',courses:'1' } });
    if (url.pathname === '/api/services') return route.fulfill({ json: [] });
    return route.fulfill({ status: 401, json: {} });
  });
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/formacion');
    const nav = page.getByRole('navigation', { name: 'Navegación principal' });
    if (width === 320) await nav.getByRole('button', { name: 'Abrir menú', exact: true }).click();
    await nav.getByRole('button', { name: 'Formación', exact: true }).filter({ visible: true }).click();
    await expect(page.locator('footer').getByRole('link', { name: 'Curso repetido', exact: true })).toHaveCount(2);
    for (const course of courses) {
      await expect(page.locator(`footer a[href="/formacion/${course.slug}"]`)).toHaveText('Curso repetido');
      await expect(page.locator(`nav a[href="/formacion/${course.slug}"]`).filter({ visible: true })).toBeVisible();
    }
  }
  expect(warnings).toEqual([]);
});
