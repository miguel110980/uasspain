import { expect, test } from '@playwright/test';
import { sql } from '../../scripts/e2e/auth-fixtures.mjs';

test('migrated courses can change category and preserve their public URLs', async ({ page, baseURL }) => {
  expect(['https://localhost:8444', 'http://127.0.0.1:8011']).toContain(baseURL);
  await page.goto('/?auth=login');
  await page.getByLabel('Correo electrónico *', { exact: true }).fill('e2e-admin@test.local');
  await page.getByLabel('Contraseña *', { exact: true }).fill('E2eAdmin_2026!'); // pragma: allowlist secret - isolated fixture
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.locator('aside:visible nav').getByRole('button', { name: 'Formación / Cursos', exact: true }).click();
  const response = await page.request.get('/api/courses');
  const imported = (await response.json()).filter(course => course.slug.includes('/'));
  const stored = JSON.parse(sql("SELECT jsonb_agg(jsonb_build_object('id',id::text,'category',category) ORDER BY id) FROM courses WHERE status IN ('upcoming','published') AND position('/' in slug)>0"));
  expect(imported.map(({ id, category }) => ({ id, category })).sort((a,b) => a.id.localeCompare(b.id))).toEqual(stored.sort((a,b) => a.id.localeCompare(b.id)));
  for (const category of ['easa', 'non_easa', 'instructor']) expect(imported.some(course => course.category === category)).toBe(true);
  const legacy = imported.find(course => course.slug === 'easa/sts-01');
  const newModality = legacy.modality === 'online' ? 'presencial' : 'online';
  const headers = { 'X-UASSpain-Window-Id': await page.evaluate(() => sessionStorage.getItem('uasspain.window_session_id') || '') };
  let ownedCourse: { id: string; slug: string } | undefined;
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: legacy.name, exact: true }) });
  await card.getByRole('button', { name: 'Editar', exact: true }).click();
  const form = page.getByRole('form', { name: 'Editar curso', exact: true });
  await expect(form.getByLabel('Categoría', { exact: true })).toHaveValue('easa');
  await expect(form.getByLabel('Tema 1', { exact: true })).toHaveValue('Reglamentación EASA para STS-01');
  const publicPage = await page.context().newPage();
  await publicPage.setViewportSize({ width: 1440, height: 900 });
  try {
    await publicPage.goto('/');
    await publicPage.getByRole('button', { name: 'Formación', exact: true }).click();
    const menu = publicPage.locator('[id^="desktop-menu-"]').filter({ visible: true });
    const link = menu.getByRole('link', { name: legacy.name, exact: true });
    await expect(link).toBeVisible();
    const oldGroup = await link.evaluate(node => {
      let sibling = node.previousElementSibling;
      while (sibling?.tagName === 'A') sibling = sibling.previousElementSibling;
      return sibling?.textContent?.trim();
    });
    expect(oldGroup).toBe('Cursos EASA');
    await form.getByLabel('Categoría', { exact: true }).selectOption('other');
    await form.getByLabel('Modalidad', { exact: true }).selectOption(newModality);
    await form.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect.poll(() => link.evaluate(node => {
      let sibling = node.previousElementSibling;
      while (sibling?.tagName === 'A') sibling = sibling.previousElementSibling;
      return sibling?.textContent?.trim();
    })).toBe('Otros cursos');
    const changedCourse = await (await page.request.get('/api/courses/easa/sts-01')).json();
    expect(changedCourse.short_description).toBe(legacy.short_description);
    expect(changedCourse.modality).toBe(newModality);
    const serverBody = await page.request.get('/api/public/seo/course-body/easa/sts-01');
    const bodyHtml = await serverBody.text();
    expect(bodyHtml).toContain(`<dd>${newModality === 'presencial' ? 'Presencial' : 'Online'}</dd>`);
    expect(bodyHtml).not.toContain(`<p>${changedCourse.presentation.format_label}</p>`);
    await link.click();
    await expect(publicPage).toHaveURL(/\/formacion\/easa\/sts-01$/);
    await expect(publicPage.getByRole('heading', { name: 'Piloto UAS STS-01', exact: true })).toBeVisible();
    await expect(publicPage.locator('dd').getByText(newModality === 'presencial' ? 'Presencial' : 'Online', { exact: true })).toBeVisible();
    await publicPage.reload();
    await expect(publicPage.getByRole('heading', { name: 'Piloto UAS STS-01', exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Editar', exact: true }).click();
    await expect(form.getByLabel('Categoría', { exact: true })).toHaveValue('other');
    await form.getByLabel('Categoría', { exact: true }).selectOption('easa');
    await form.getByLabel('Modalidad', { exact: true }).selectOption(legacy.modality);
    await form.getByRole('button', { name: 'Guardar', exact: true }).click();
    // Deletion must not consume a migrated seed needed by another scenario.
    const name = `TEMP Retirada catálogo ${Date.now()}`;
    const created = await page.request.post('/api/admin/courses', { headers, data: {
      name, category: 'easa', description: 'Curso sintético exclusivo de esta prueba.',
      modality: 'online', duration: '1 hora', status: 'published', sections: [],
    } });
    expect(created.status()).toBe(201);
    ownedCourse = await created.json();
    await page.getByRole('button', { name: 'Actualizar cursos', exact: true }).click();
    const removed = page.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await removed.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await page.getByRole('button', { name: 'Eliminar curso', exact: true }).click();
    await expect(removed).toHaveCount(0);
    expect((await page.request.get(`/api/courses/${ownedCourse.slug}`)).status()).toBe(404);
    await publicPage.goto('/formacion');
    await expect(publicPage.getByRole('heading', { name, exact: true })).toHaveCount(0);
  } finally {
    const current = await (await page.request.get('/api/admin/courses', { headers })).json();
    const original = current.find(course => course.id === legacy.id);
    if (original && (original.category !== legacy.category || original.modality !== legacy.modality)) {
      expect((await page.request.patch(`/api/admin/courses/${legacy.id}`, { headers: { ...headers, 'If-Match': String(original.version) }, data: { category: legacy.category, modality: legacy.modality } })).status()).toBe(200);
    }
    const remaining = ownedCourse && current.find(course => course.id === ownedCourse.id);
    if (remaining) expect((await page.request.delete(`/api/admin/courses/${remaining.id}`, { headers: { ...headers, 'If-Match': String(remaining.version) } })).status()).toBe(204);
    await publicPage.close();
  }
});
