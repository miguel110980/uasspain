import { expect, test } from '@playwright/test';
import { sql } from '../../scripts/e2e/auth-fixtures.mjs';

test('admin lists all database courses and refreshes when returning to the section', async ({ page, baseURL }) => {
  expect(['https://localhost:8444', 'http://127.0.0.1:8011']).toContain(baseURL);
  await page.goto('/?auth=login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Correo electrónico *', { exact: true }).fill('e2e-admin@test.local');
  await page.getByLabel('Contraseña *', { exact: true }).fill('E2eAdmin_2026!'); // pragma: allowlist secret - isolated fixture
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  const nav = page.locator('aside:visible nav');
  await nav.getByRole('button', { name: 'Formación / Cursos', exact: true }).click();
  const headers = {
    Origin: baseURL || 'http://127.0.0.1:8011',
    'X-UASSpain-Window-ID': await page.evaluate(() => sessionStorage.getItem('uasspain.window_session_id') || ''),
  };
  const response = await page.request.get('/api/admin/courses', { headers });
  expect(response.status()).toBe(200);
  const original = await response.json();
  // Deleted catalogue entries remain stored as history and are deliberately
  // absent from the editor. Include every other status, including drafts.
  const storedIds: string[] = JSON.parse(sql("SELECT COALESCE(jsonb_agg(id::text ORDER BY id),'[]') FROM courses WHERE status<>'deleted'"));
  expect(original.map(course => course.id).sort()).toEqual(storedIds.sort());
  expect(original.length).toBeGreaterThan(0);
  await expect(page.getByRole('article')).toHaveCount(original.length);
  for (const course of original) {
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: course.name, exact: true }) });
    await expect(card.getByRole('button', { name: 'Editar', exact: true })).toHaveCount(1);
    await expect(card.getByRole('button', { name: 'Eliminar', exact: true })).toHaveCount(1);
    await card.getByRole('button', { name: 'Editar', exact: true }).click();
    const form = page.getByRole('form', { name: 'Editar curso', exact: true });
    await expect(form.getByLabel('Nombre del curso', { exact: true })).toHaveValue(course.name);
    await expect(form.getByLabel('Categoría', { exact: true })).toHaveValue(course.category);
    expect(await form.locator('input[id^="topic-"]').count()).toBe(course.sections.length);
    await form.getByRole('button', { name: 'Cancelar edición', exact: true }).click();
  }
  let id: string | undefined;
  const name = `TEMP Curso actualización ${Date.now()}`;
  try {
    await nav.getByRole('button', { name: 'Dashboard', exact: true }).click();
    const created = await page.request.post('/api/admin/courses', { headers, data: {
      name, category: 'other', description: 'Curso de prueba de actualización del listado.',
      modality: 'online', duration: '20 horas', status: 'published', sections: [],
    } });
    expect(created.status()).toBe(201);
    id = (await created.json()).id;
    await nav.getByRole('button', { name: 'Formación / Cursos', exact: true }).click();
    await expect(page.getByRole('heading', { name: `Cursos guardados (${original.length + 1})`, exact: true })).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(original.length + 1);
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    expect((await page.request.delete(`/api/admin/courses/${id}`, { headers: { ...headers, 'If-Match': '1' } })).status()).toBe(204);
    id = undefined;
    await page.getByRole('button', { name: 'Actualizar cursos', exact: true }).click();
    await expect(page.getByRole('article')).toHaveCount(original.length);
    await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
  } finally {
    if (id) await page.request.delete(`/api/admin/courses/${id}`, { headers: { ...headers, 'If-Match': '1' } });
  }
});
