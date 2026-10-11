import { expect, test } from '@playwright/test';

test('admin lists all database courses and refreshes when returning to the section', async ({ page, baseURL }) => {
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
  expect(original).toHaveLength(14);
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
  try {
    await nav.getByRole('button', { name: 'Dashboard', exact: true }).click();
    const created = await page.request.post('/api/admin/courses', { headers, data: {
      name: 'Aeromodelismo', category: 'other', description: 'Curso de prueba de aeromodelismo.',
      modality: 'online', duration: '20 horas', status: 'published', sections: [],
    } });
    expect(created.status()).toBe(201);
    id = (await created.json()).id;
    await nav.getByRole('button', { name: 'Formación / Cursos', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Cursos guardados (15)', exact: true })).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(15);
    await expect(page.getByRole('heading', { name: 'Aeromodelismo', exact: true })).toBeVisible();
    expect((await page.request.delete(`/api/admin/courses/${id}`, { headers: { ...headers, 'If-Match': '1' } })).status()).toBe(204);
    id = undefined;
    await page.getByRole('button', { name: 'Actualizar cursos', exact: true }).click();
    await expect(page.getByRole('article')).toHaveCount(14);
    await expect(page.getByRole('heading', { name: 'Aeromodelismo', exact: true })).toHaveCount(0);
  } finally {
    if (id) await page.request.delete(`/api/admin/courses/${id}`, { headers: { ...headers, 'If-Match': '1' } });
  }
});
