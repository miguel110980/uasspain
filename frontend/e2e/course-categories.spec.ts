import { expect, test } from '@playwright/test';

test('migrated courses can change category and preserve their public URLs', async ({ page }) => {
  await page.goto('/?auth=login');
  await page.getByLabel('Correo electrónico *', { exact: true }).fill('e2e-admin@test.local');
  await page.getByLabel('Contraseña *', { exact: true }).fill('E2eAdmin_2026!'); // pragma: allowlist secret - isolated fixture
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.locator('aside:visible nav').getByRole('button', { name: 'Formación / Cursos', exact: true }).click();
  const response = await page.request.get('/api/courses');
  const imported = (await response.json()).filter(course => course.slug.includes('/'));
  expect(imported).toHaveLength(14);
  expect(imported.filter(course => course.category === 'easa')).toHaveLength(5);
  expect(imported.filter(course => course.category === 'non_easa')).toHaveLength(6);
  expect(imported.filter(course => course.category === 'instructor')).toHaveLength(3);
  const legacy = imported.find(course => course.slug === 'easa/sts-01');
  const newModality = legacy.modality === 'online' ? 'presencial' : 'online';
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
    const removed = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'A2', exact: true }) });
    await removed.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await page.getByRole('button', { name: 'Eliminar curso', exact: true }).click();
    await expect(removed).toHaveCount(0);
    expect((await page.request.get('/api/courses/easa/a2')).status()).toBe(404);
    await publicPage.goto('/formacion');
    await expect(publicPage.getByRole('heading', { name: 'A2', exact: true })).toHaveCount(0);
  } finally {
    await publicPage.close();
  }
});
