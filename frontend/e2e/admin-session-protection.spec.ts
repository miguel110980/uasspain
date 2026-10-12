import { test, expect, type Page } from '@playwright/test';
import { sql, uuid } from '../../scripts/e2e/auth-fixtures.mjs';
import { concurrentFixtures } from '../../scripts/e2e/concurrent-fixtures.mjs';

test('@admin-protection all ADMIN accounts retain details only; other roles retain working management actions', async ({ browser, baseURL }) => {
  test.setTimeout(180000);
  expect(['https://localhost:8444', 'http://127.0.0.1:8011']).toContain(baseURL);
  const baselineIds = new Set(sql('SELECT id FROM accounts_userprofile').split('\n'));
  const seed = await concurrentFixtures(8);
  const ownedIds = sql('SELECT id FROM accounts_userprofile').split('\n').filter(id => !baselineIds.has(id)).map(uuid);
  const owners = ownedIds.map(id => `'${id}'`).join(',');
  const userIds = sql(`SELECT user_id FROM accounts_userprofile WHERE id IN (${owners})`).split('\n').map(Number);
  expect(userIds.every(Number.isSafeInteger)).toBe(true);
  const contexts = await Promise.all([0, 7, 1, 3].map(() => browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })));
  const [admin, other, instructor, student] = await Promise.all(contexts.map(context => context.newPage()));
  const errors: string[] = [];
  const frames: unknown[] = [];
  admin.on('websocket', socket => { if (socket.url().includes('/ws/conexiones/')) socket.on('framereceived', event => frames.push(event.payload)); });
  for (const page of [admin, other, instructor, student]) page.on('pageerror', error => errors.push(error.message));
  const login = async (page: Page, index: number) => {
    const fixture = seed.fixtures[index];
    await page.goto('/?auth=login');
    await page.getByLabel('Correo electrónico *', { exact: true }).fill(fixture.email);
    await page.getByLabel('Contraseña *', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    if (index === 7) { await expect(page).toHaveURL(/elegir-panel/); await page.getByRole('button', { name: /Instructor/ }).click(); }
    await expect(page.locator('header h1')).toHaveText('Dashboard');
  };
  const row = (index: number) => admin.getByRole('row').filter({ hasText: seed.fixtures[index].email });
  const headers = async (page: Page) => ({ Origin: baseURL, 'X-UASSpain-Window-Id': await page.evaluate(() => sessionStorage.getItem('uasspain.window_session_id') || '') });
  try {
    await login(admin, 0); await login(other, 7); await login(instructor, 1); await login(student, 3);
    await admin.locator('aside:visible nav').getByRole('button', { name: 'Conexiones en vivo', exact: true }).click();
    for (const index of [0, 7]) {
      await expect(row(index)).toBeVisible();
      await expect(row(index).getByRole('button')).toHaveCount(1);
      await expect(row(index).getByRole('button', { name: 'Ver detalles', exact: true })).toBeVisible();
      await row(index).getByRole('button', { name: 'Ver detalles', exact: true }).click();
      const modal = admin.getByRole('dialog', { name: 'Detalles de la conexion' });
      await expect(modal).toBeVisible(); await expect(modal).toContainText(seed.fixtures[index].email);
      await modal.getByRole('button', { name: 'Cerrar', exact: true }).click(); await expect(modal).toHaveCount(0);
      expect((await admin.request.patch(`/api/profiles/${seed.fixtures[index].id}/`, { headers: await headers(admin), data: { status: 'bloqueado', role: 'alumno', roles: ['alumno'] } })).status()).toBe(403);
    }
    for (const index of [1, 3]) {
      await expect(row(index).getByRole('button')).toHaveCount(4);
      await expect(row(index).getByRole('button', { name: 'Finalizar sesión', exact: true })).toBeVisible();
      await expect(row(index).getByRole('button', { name: 'Bloquear usuario', exact: true })).toBeVisible();
    }
    // Responsive and theme changes preserve the actual rendered action count.
    for (const theme of ['light', 'dark']) for (const width of [390, 768, 1440]) {
      await admin.setViewportSize({ width, height: 900 });
      await admin.evaluate(value => { localStorage.setItem('theme', value); document.documentElement.classList.toggle('dark', value === 'dark'); document.documentElement.classList.toggle('light', value === 'light'); }, theme);
      await expect(row(0).getByRole('button')).toHaveCount(1); await expect(row(7).getByRole('button')).toHaveCount(1);
      expect(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await admin.screenshot({ path: `.run/admin-protection-20261012/admin-actions-${theme}-${width}.png`, fullPage: true });
    }
    await admin.reload();
    await admin.locator('aside:visible nav').getByRole('button', { name: 'Conexiones en vivo', exact: true }).click();
    await expect(row(7).getByRole('button')).toHaveCount(1);
    admin.on('dialog', dialog => dialog.type() === 'confirm' ? dialog.accept() : dialog.dismiss());
    await row(1).getByRole('button', { name: 'Finalizar sesión', exact: true }).click();
    await expect(row(1)).toHaveCount(0);
    expect((await instructor.request.get('/api/auth/me/', { headers: await headers(instructor) })).status()).toBe(401);
    await row(3).getByRole('button', { name: 'Bloquear usuario', exact: true }).click();
    await expect(row(3)).toHaveCount(0, { timeout: 20000 });
    expect((await student.request.get('/api/auth/me/', { headers: await headers(student) })).status()).toBe(401);
    expect((await other.request.get('/api/auth/me/', { headers: await headers(other) })).status()).toBe(200);
    expect(frames.length).toBeGreaterThan(0); expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    const logIds = sql(`SELECT id FROM conexiones_registroconexion WHERE profile_id IN (${owners})`).split('\n').filter(Boolean).map(uuid);
    await seed.cleanup();
    if (logIds.length) sql(`DELETE FROM conexiones_registroconexion WHERE id IN (${logIds.map(id => `'${id}'`).join(',')})`);
    sql(`DELETE FROM auth_user WHERE id IN (${userIds.join(',')}) AND NOT EXISTS(SELECT 1 FROM accounts_userprofile WHERE user_id=auth_user.id)`);
    expect(Number(sql(`SELECT (SELECT count(*) FROM accounts_userprofile WHERE id IN (${owners}))+(SELECT count(*) FROM auth_tab_session WHERE profile_id IN (${owners}))`))).toBe(0);
  }
});
