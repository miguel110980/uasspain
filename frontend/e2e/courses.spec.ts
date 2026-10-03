import { expect, test } from '@playwright/test';

test('course management updates the catalog, stable URL and ordered topics in real time', { tag: '@course-module' }, async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/?auth=login');
  await page.getByLabel('Correo electrónico *', { exact: true }).fill('e2e-admin@test.local');
  await page.getByLabel('Contraseña *', { exact: true }).fill('E2eAdmin_2026!'); // pragma: allowlist secret - isolated fixture
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.locator('aside:visible nav').getByRole('button', { name: 'Formación / Cursos', exact: true }).click();
  const name = `Curso completo ${Date.now()}`;
  let id: string | undefined;
  const publicPage = await page.context().newPage();
  const catalogPage = await page.context().newPage();
  await publicPage.setViewportSize({ width: 1440, height: 900 });
  await publicPage.goto('/');
  await publicPage.getByRole('button', { name: 'Formación', exact: true }).click();
  try {
    const form = page.getByRole('form', { name: 'Nuevo curso', exact: true });
    await expect(form.locator('input[type="number"], input[type="file"]')).toHaveCount(0);
    await expect(form.getByPlaceholder('slug-opcional')).toHaveCount(0);
    await form.getByLabel('Nombre del curso', { exact: true }).fill(`  ${name}  `);
    await form.getByLabel('Descripción', { exact: true }).fill('  Descripción pública completa.  ');
    for (const title of ['Tema A', 'Tema B', 'Tema descartado']) {
      await form.getByRole('button', { name: 'Añadir tema', exact: true }).click();
      const index = await form.locator('input[id^="topic-"]').count();
      await form.getByLabel(`Tema ${index}`, { exact: true }).fill(title);
    }
    await form.getByRole('button', { name: 'Eliminar tema 3', exact: true }).click();
    await form.getByRole('button', { name: 'Subir tema 2', exact: true }).click();
    await form.getByLabel('Contenido del tema 1', { exact: true }).fill('Operaciones seguras.');
    await form.getByLabel('Modalidad', { exact: true }).selectOption('presencial');
    await expect(form.getByLabel('Categoría', { exact: true })).toHaveAttribute('required', '');
    await expect(form.getByLabel('Categoría', { exact: true }).locator('option')).toHaveText(['Curso EASA', 'Curso no EASA', 'Curso de Instructor', 'Otros cursos']);
    await form.getByLabel('Categoría', { exact: true }).selectOption('other');
    await form.getByLabel('Duración', { exact: true }).fill('  3 semanas (24 horas)  ');
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await form.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await form.getByRole('button', { name: 'Guardar', exact: true }).scrollIntoViewIfNeeded();
      await expect(form.getByRole('button', { name: 'Guardar', exact: true })).toBeInViewport();
    }
    const created = page.waitForResponse(response => response.url().endsWith('/api/admin/courses') && response.request().method() === 'POST');
    await form.getByRole('button', { name: 'Guardar', exact: true }).click();
    const response = await created; expect(response.status()).toBe(201);
    const course = await response.json(); id = course.id;
    expect(course.name).toBe(name); expect(course.duration).toBe('3 semanas (24 horas)');
    expect(course.category).toBe('other');
    expect(course.sections.map(topic => [topic.title, topic.sort_order])).toEqual([['Tema B', 0], ['Tema A', 1]]);
    expect((await page.request.get(`/api/courses/${course.slug}`)).status()).toBe(404);
    await expect(publicPage.getByRole('link', { name, exact: true })).toHaveCount(0);
    await catalogPage.goto('/formacion');
    const catalogCard = catalogPage.getByRole('article').filter({ has: catalogPage.getByRole('heading', { name, exact: true }) });
    await expect(catalogCard.getByText('Próximamente', { exact: true })).toBeVisible();
    await expect(catalogCard.getByRole('link')).toHaveCount(0);
    const card = () => page.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await card().getByRole('button', { name: 'Editar', exact: true }).click();
    const edit = page.getByRole('form', { name: 'Editar curso', exact: true });
    await expect(edit.getByLabel('Tema 1', { exact: true })).toHaveValue('Tema B');
    await expect(edit.getByLabel('Categoría', { exact: true })).toHaveValue('other');
    await edit.getByLabel('Estado', { exact: true }).selectOption('published');
    await edit.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(publicPage.getByRole('link', { name, exact: true })).toBeVisible();
    await expect(catalogCard.getByText('Publicado', { exact: true })).toBeVisible();
    await expect(catalogCard.getByRole('link', { name: 'Ver curso', exact: true })).toHaveAttribute('href', `/formacion/${course.slug}`);
    await publicPage.getByRole('link', { name, exact: true }).click();
    await expect(publicPage).toHaveURL(new RegExp(`/formacion/${course.slug}$`));
    await expect(publicPage.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(publicPage.getByRole('heading', { name: 'Descripción', exact: true }).locator('..').getByText('Descripción pública completa.', { exact: true })).toBeVisible();
    await expect(publicPage.getByText('Presencial', { exact: true })).toBeVisible();
    await expect(publicPage.getByText('3 semanas (24 horas)', { exact: true })).toBeVisible();
    expect(await publicPage.locator('main ol h3').allTextContents()).toEqual(['Tema B', 'Tema A']);
    await publicPage.reload();
    await expect(publicPage.getByRole('heading', { name, exact: true })).toBeVisible();
    for (const width of [320, 390, 768]) {
      await publicPage.setViewportSize({ width, height: 900 });
      await publicPage.goto('/');
      await publicPage.getByRole('button', { name: 'Abrir menú', exact: true }).click();
      const menu = publicPage.getByRole('dialog', { name: 'Menú de navegación', exact: true });
      await menu.getByRole('button', { name: 'Formación', exact: true }).click();
      const link = menu.getByRole('link', { name, exact: true });
      await expect(link).toBeVisible();
      expect(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await link.click();
      await expect(publicPage.getByRole('heading', { name, exact: true })).toBeVisible();
    }
    for (const theme of ['dark', 'light']) for (const width of [320, 390, 768, 1440]) {
      await publicPage.evaluate(value => document.documentElement.classList.toggle('light', value === 'light'), theme);
      await publicPage.setViewportSize({ width, height: 900 });
      expect(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    await card().getByRole('button', { name: 'Editar', exact: true }).click();
    await edit.getByLabel('Nombre del curso', { exact: true }).fill(`${name} actualizado`);
    await edit.getByRole('button', { name: 'Eliminar tema 2', exact: true }).click();
    await edit.getByLabel('Tema 1', { exact: true }).fill('Tema actualizado');
    await edit.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(publicPage.getByRole('heading', { name: `${name} actualizado`, exact: true })).toBeVisible();
    await expect(publicPage).toHaveURL(new RegExp(`/formacion/${course.slug}$`));
    expect(await publicPage.locator('main ol h3').allTextContents()).toEqual(['Tema actualizado']);
    const editedCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: `${name} actualizado`, exact: true }) });
    await editedCard.getByRole('button', { name: 'Editar', exact: true }).click();
    await edit.getByLabel('Estado', { exact: true }).selectOption('upcoming');
    await edit.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(publicPage.getByRole('heading', { name: `${name} actualizado`, exact: true })).toHaveCount(0);
    await publicPage.setViewportSize({ width: 1440, height: 900 });
    await publicPage.goto('/');
    await publicPage.getByRole('button', { name: 'Formación', exact: true }).click();
    await expect(publicPage.getByRole('link', { name: `${name} actualizado`, exact: true })).toHaveCount(0);
    const updatedCatalogCard = catalogPage.getByRole('article').filter({ has: catalogPage.getByRole('heading', { name: `${name} actualizado`, exact: true }) });
    await expect(updatedCatalogCard.getByText('Próximamente', { exact: true })).toBeVisible();
    await expect(updatedCatalogCard.getByRole('link')).toHaveCount(0);
    await editedCard.getByRole('button', { name: 'Editar', exact: true }).click();
    await edit.getByLabel('Estado', { exact: true }).selectOption('published');
    await edit.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(publicPage.getByRole('link', { name: `${name} actualizado`, exact: true })).toBeVisible();
    await publicPage.getByRole('link', { name: `${name} actualizado`, exact: true }).click();
    await expect(publicPage.getByRole('heading', { name: `${name} actualizado`, exact: true })).toBeVisible();
    await editedCard.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(editedCard).toBeVisible();
    await editedCard.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await page.getByRole('button', { name: 'Eliminar curso', exact: true }).click();
    await expect(editedCard).toHaveCount(0);
    await expect(updatedCatalogCard).toHaveCount(0);
    await expect(publicPage.getByRole('heading', { name: `${name} actualizado`, exact: true })).toHaveCount(0);
    expect((await page.request.get(`/api/courses/${course.slug}`)).status()).toBe(404);
    await publicPage.goto('/');
    await publicPage.getByRole('button', { name: 'Formación', exact: true }).click();
    await expect(publicPage.getByRole('link', { name: `${name} actualizado`, exact: true })).toHaveCount(0);
    id = undefined;
  } finally {
    if (id) await page.request.delete(`/api/admin/courses/${id}`, { headers: { 'X-UASSpain-Window-ID': await page.evaluate(() => sessionStorage.getItem('uasspain.window_session_id') || '') } });
    await publicPage.close();
    await catalogPage.close();
  }
});
