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
  const description = `Descripción pública completa. ${'Información general de la formación. '.repeat(12)}Detalle completo pendiente.`;
  let id: string | undefined;
  const publicPage = await page.context().newPage();
  const catalogPage = await page.context().newPage();
  await publicPage.setViewportSize({ width: 1440, height: 900 });
  await publicPage.goto('/');
  await publicPage.getByRole('button', { name: 'Formación', exact: true }).click();
  try {
    const form = page.getByRole('form', { name: 'Nuevo curso', exact: true });
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await form.getByLabel('Nombre del curso', { exact: true }).scrollIntoViewIfNeeded();
      await expect(form.getByLabel('Categoría', { exact: true })).toBeInViewport();
      expect(await form.evaluate(el => Boolean(el.querySelector('#course-category').compareDocumentPosition(el.querySelector('#course-description')) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    }
    await expect(form.locator('input[type="number"], input[type="file"]')).toHaveCount(0);
    await expect(form.getByPlaceholder('slug-opcional')).toHaveCount(0);
    await form.getByLabel('Nombre del curso', { exact: true }).fill(`  ${name}  `);
    await form.getByLabel('Descripción', { exact: true }).fill(`  ${description}  `);
    for (const title of ['Tema A', 'Tema B', 'Tema descartado']) {
      await form.getByRole('button', { name: 'Añadir tema', exact: true }).click();
      const index = await form.locator('input[id^="topic-"]').count();
      await form.getByLabel(`Tema ${index}`, { exact: true }).fill(title);
    }
    await form.getByRole('button', { name: 'Eliminar tema 3', exact: true }).click();
    await form.getByRole('button', { name: 'Subir tema 2', exact: true }).click();
    await form.getByLabel('Contenido del tema 1', { exact: true }).fill('Operaciones seguras.');
    await expect(form.getByLabel('Modalidad', { exact: true }).locator('option')).toHaveText(['Online', 'Presencial', 'Presencial/Online']);
    await form.getByLabel('Modalidad', { exact: true }).selectOption('presencial_online');
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
    expect(course.modality).toBe('presencial_online');
    expect(course.sections.map(topic => [topic.title, topic.sort_order])).toEqual([['Tema B', 0], ['Tema A', 1]]);
    const assertUpcomingApi = async (modality = 'presencial_online') => {
      const detail = await page.request.get(`/api/courses/${course.slug}`);
      expect(detail.status()).toBe(200);
      expect(await detail.json()).toMatchObject({ modality, status: 'upcoming', content_available: false, description: '', introduction: '', syllabus: '', sections: [] });
      expect((await page.request.get(`/api/public/seo/course-route/${course.slug}`)).status()).toBe(200);
      const head = await page.request.get(`/api/public/seo/course-head/${course.slug}`);
      expect(head.status()).toBe(200);
      expect(await head.text()).toContain('content="noindex, follow"');
      const body = await page.request.get(`/api/public/seo/course-body/${course.slug}`);
      expect(body.status()).toBe(200);
      expect(await body.text()).toContain('Próximamente');
      expect(await body.text()).not.toContain('Detalle completo pendiente.');
      expect(await body.text()).not.toContain('Operaciones seguras.');
      expect(await (await page.request.get('/api/public/seo/sitemap-courses.xml')).text()).not.toContain(`/formacion/${course.slug}</loc>`);
    };
    await assertUpcomingApi();
    await expect(publicPage.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name, exact: true })).toHaveCount(0);
    await catalogPage.goto('/formacion');
    const catalogCard = catalogPage.getByRole('article').filter({ has: catalogPage.getByRole('heading', { name, exact: true }) });
    await expect(catalogCard.getByText('Próximamente', { exact: true })).toBeVisible();
    await expect(catalogCard).toContainText('Presencial/Online · 3 semanas (24 horas)');
    await expect(catalogCard.getByRole('link', { name: 'Ver curso', exact: true })).toHaveAttribute('href', `/formacion/${course.slug}`);
    await catalogCard.getByRole('link', { name: 'Ver curso', exact: true }).click();
    await expect(catalogPage.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(catalogPage.getByText('Presencial/Online', { exact: true })).toBeVisible();
    await expect(catalogPage.getByRole('heading', { name: 'Próximamente', exact: true })).toBeVisible();
    await expect(catalogPage.getByText('Detalle completo pendiente.', { exact: false })).toHaveCount(0);
    await expect(catalogPage.locator('main ol h3')).toHaveCount(0);
    await catalogPage.reload();
    await expect(catalogPage.getByRole('heading', { name: 'Próximamente', exact: true })).toBeVisible();
    await catalogPage.goto('/formacion');
    const card = () => page.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await card().getByRole('button', { name: 'Editar', exact: true }).click();
    const edit = page.getByRole('form', { name: 'Editar curso', exact: true });
    await expect(edit.getByLabel('Tema 1', { exact: true })).toHaveValue('Tema B');
    await expect(edit.getByLabel('Categoría', { exact: true })).toHaveValue('other');
    await expect(edit.getByLabel('Modalidad', { exact: true })).toHaveValue('presencial_online');
    await edit.getByLabel('Estado', { exact: true }).selectOption('published');
    await edit.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(publicPage.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name, exact: true })).toBeVisible();
    await expect(catalogCard.getByText('Publicado', { exact: true })).toBeVisible();
    await expect(catalogCard.getByRole('link', { name: 'Ver curso', exact: true })).toHaveAttribute('href', `/formacion/${course.slug}`);
    await publicPage.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name, exact: true }).click();
    await expect(publicPage).toHaveURL(new RegExp(`/formacion/${course.slug}$`));
    await expect(publicPage.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(publicPage.getByRole('heading', { name: 'Descripción', exact: true }).locator('..').getByText(description, { exact: true })).toBeVisible();
    expect(await (await page.request.get(`/api/public/seo/course-head/${course.slug}`)).text()).toContain('content="index, follow, max-image-preview:large"');
    expect(await (await page.request.get(`/api/public/seo/course-body/${course.slug}`)).text()).toContain('Operaciones seguras.');
    expect(await (await page.request.get('/api/public/seo/sitemap-courses.xml')).text()).toContain(`/formacion/${course.slug}</loc>`);
    await expect(publicPage.getByText('Presencial/Online', { exact: true })).toBeVisible();
    expect(await (await page.request.get(`/api/public/seo/course-body/${course.slug}`)).text()).toContain('<dd>Presencial/Online</dd>');
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
    await edit.getByLabel('Modalidad', { exact: true }).selectOption('online');
    await edit.getByRole('button', { name: 'Eliminar tema 2', exact: true }).click();
    await edit.getByLabel('Tema 1', { exact: true }).fill('Tema actualizado');
    await edit.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(publicPage.getByRole('heading', { name: `${name} actualizado`, exact: true })).toBeVisible();
    await expect(publicPage.getByText('Online', { exact: true })).toBeVisible();
    expect(await (await page.request.get(`/api/courses/${course.slug}`)).json()).toMatchObject({ modality: 'online' });
    await expect(publicPage).toHaveURL(new RegExp(`/formacion/${course.slug}$`));
    expect(await publicPage.locator('main ol h3').allTextContents()).toEqual(['Tema actualizado']);
    const editedCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: `${name} actualizado`, exact: true }) });
    await editedCard.getByRole('button', { name: 'Editar', exact: true }).click();
    await expect(edit.getByLabel('Modalidad', { exact: true })).toHaveValue('online');
    await edit.getByLabel('Modalidad', { exact: true }).selectOption('presencial');
    await edit.getByLabel('Estado', { exact: true }).selectOption('upcoming');
    await edit.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(publicPage.getByRole('heading', { name: `${name} actualizado`, exact: true })).toBeVisible();
    await expect(publicPage.getByRole('heading', { name: 'Próximamente', exact: true })).toBeVisible();
    await expect(publicPage.locator('main ol h3')).toHaveCount(0);
    await assertUpcomingApi('presencial');
    await publicPage.setViewportSize({ width: 1440, height: 900 });
    await publicPage.goto('/');
    await publicPage.getByRole('button', { name: 'Formación', exact: true }).click();
    await expect(publicPage.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: `${name} actualizado`, exact: true })).toHaveCount(0);
    const updatedCatalogCard = catalogPage.getByRole('article').filter({ has: catalogPage.getByRole('heading', { name: `${name} actualizado`, exact: true }) });
    await expect(updatedCatalogCard.getByText('Próximamente', { exact: true })).toBeVisible();
    await expect(updatedCatalogCard.getByRole('link', { name: 'Ver curso', exact: true })).toHaveAttribute('href', `/formacion/${course.slug}`);
    await editedCard.getByRole('button', { name: 'Editar', exact: true }).click();
    await edit.getByLabel('Estado', { exact: true }).selectOption('published');
    await edit.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(publicPage.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: `${name} actualizado`, exact: true })).toBeVisible();
    await publicPage.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: `${name} actualizado`, exact: true }).click();
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
    await expect(publicPage.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: `${name} actualizado`, exact: true })).toHaveCount(0);
    id = undefined;
  } finally {
    if (id) {
      const headers = { 'X-UASSpain-Window-ID': await page.evaluate(() => sessionStorage.getItem('uasspain.window_session_id') || '') };
      const courses = await (await page.request.get('/api/admin/courses', { headers })).json();
      const course = courses.find(item => item.id === id);
      if (course) await page.request.delete(`/api/admin/courses/${id}`, { headers: { ...headers, 'If-Match': String(course.version) } });
    }
    await publicPage.close();
    await catalogPage.close();
  }
});
