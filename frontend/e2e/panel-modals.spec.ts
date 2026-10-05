import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const accounts = {
  admin: ['e2e-admin@test.local', 'E2eAdmin_2026!'], // pragma: allowlist secret - isolated fixture
  instructor: ['instructor.e2e@test.local', 'E2eInstr_2026!'], // pragma: allowlist secret - isolated fixture
  alumno: ['alumno.e2e@test.local', 'E2ePass_2026!'], // pragma: allowlist secret - isolated fixture
};
const viewports = [
  [320, 568], [360, 640], [375, 667], [390, 844], [412, 915],
  [768, 600], [1024, 600], [1366, 768], [1920, 1080],
];

async function login(page: Page, role: keyof typeof accounts) {
  await page.goto('/?auth=login');
  await page.getByLabel('Correo electrónico *', { exact: true }).fill(accounts[role][0]);
  await page.getByLabel('Contraseña *', { exact: true }).fill(accounts[role][1]);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${role}$`));
}

async function section(page: Page, name: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('aside:visible nav').getByRole('button', { name, exact: true }).click();
  await expect(page.locator('header h1')).toHaveText(name);
}

async function verifyDialog(page: Page, dialog: Locator, lastAction: Locator) {
  await expect(dialog).toBeVisible();
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    await expect.poll(async () => {
      const box = await dialog.boundingBox();
      return !!box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1;
    }, { message: `Dialog must fit ${width}x${height}` }).toBe(true);
    await expect.poll(() => dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await lastAction.scrollIntoViewIfNeeded();
    await expect(lastAction).toBeInViewport();
    await lastAction.focus();
    await expect(lastAction).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  for (const zoom of [1.25, 1.5]) {
    // Model the reduced CSS viewport available at desktop browser zoom.
    await page.setViewportSize({ width: Math.floor(1024 / zoom), height: Math.floor(600 / zoom) });
    await lastAction.scrollIntoViewIfNeeded();
    await expect(lastAction).toBeInViewport();
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await dialog.evaluate(element => element.setAttribute('data-ui-audit-dialog', 'true'));
  try {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(theme); }, theme);
      for (const width of [320, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(500);
        const results = await new AxeBuilder({ page }).include('[data-ui-audit-dialog="true"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        expect(results.violations, `Dialog accessibility at ${width}px in ${theme}`).toEqual([]);
      }
    }
  } finally {
    await dialog.evaluate(element => element.removeAttribute('data-ui-audit-dialog'));
    await page.setViewportSize({ width: 1440, height: 900 });
  }
}

test.describe('panel modals and data consistency', { tag: '@panel-modals' }, () => {
  test('admin can reach every user-edit field and action at all required viewport sizes', async ({ page }) => {
    await login(page, 'admin');
    await section(page, 'Gestión de Usuarios');
    const row = page.getByRole('row').filter({ hasText: 'alumno.e2e@test.local' });
    await row.getByTitle('Editar', { exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Editar usuario', exact: true });
    await verifyDialog(page, dialog, dialog.getByRole('button', { name: 'Guardar', exact: true }));
    await dialog.getByLabel('Instructor asignado', { exact: true }).scrollIntoViewIfNeeded();
    await expect(dialog.getByLabel('Instructor asignado', { exact: true })).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(row.getByTitle('Editar', { exact: true })).toBeFocused();
  });

  test('admin instructor creation, editing and nested assignment keep scrolling and focus', async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, 'admin');
    await section(page, 'Instructores');
    await page.getByRole('button', { name: 'Nuevo instructor', exact: true }).click();
    const create = page.getByRole('dialog', { name: 'Nuevo instructor', exact: true });
    await verifyDialog(page, create, create.getByRole('button', { name: /Crear instructor/ }));
    await page.keyboard.press('Escape');
    await expect(create).toHaveCount(0);
    const row = page.getByRole('row').filter({ hasText: 'instructor.e2e@test.local' });
    await row.getByTitle('Editar', { exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Editar instructor', exact: true });
    await verifyDialog(page, edit, edit.getByRole('button', { name: 'Guardar', exact: true }));
    await page.keyboard.press('Escape');
    await row.getByTitle('Ver detalles', { exact: true }).click();
    const detail = page.getByRole('dialog', { name: 'Detalles del instructor', exact: true });
    await verifyDialog(page, detail, detail.getByRole('button', { name: 'Cerrar', exact: true }).last());
    await detail.getByRole('button', { name: 'Asignar', exact: true }).click();
    const assignment = page.getByRole('dialog', { name: 'Asignar alumnos', exact: true });
    await verifyDialog(page, assignment, assignment.getByRole('button', { name: 'Cancelar', exact: true }));
    await page.keyboard.press('Escape');
    await expect(assignment).toHaveCount(0);
    await expect(detail).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  });

  test('instructor access, exam permissions and results dialogs fit short screens', async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, 'instructor');
    await section(page, 'Alumnos');
    const row = page.getByRole('row').filter({ hasText: 'alumno.e2e@test.local' });
    // A populated history makes the horizontal keyboard-scroll check independent
    // of results left by another test group. Persistence has its own real API test.
    await page.route('**/api/resultados-examen/**', route => route.fulfill({ json: [
      { id: '00000000-0000-4000-8000-000000000001', categoria: 'A1/A3', fecha: '2026-10-01T12:00:00Z', modalidad: 'libre', nota: 8, aciertos: 8, errores: 2, aprobado: true },
    ] }));
    for (const [title, label] of [['Gestionar accesos', 'Gestionar accesos'], ['Exámenes', 'Acceso a exámenes'], ['Resultados', 'Resultados del alumno']]) {
      await row.getByTitle(title, { exact: true }).click();
      const dialog = page.getByRole('dialog', { name: label, exact: true });
      if (label === 'Resultados del alumno') await expect(dialog.getByRole('table')).toBeVisible();
      await verifyDialog(page, dialog, dialog.getByRole('button', { name: 'Cerrar', exact: true }));
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    }
  });

  test('student exam setup and instructor moderation remain accessible', async ({ page, browser }) => {
    const staffContext = await browser.newContext();
    const instructor = await staffContext.newPage();
    await login(instructor, 'instructor');
    const headers = { 'X-UASSpain-Window-Id': await instructor.evaluate(() => sessionStorage.getItem('uasspain.window_session_id') || '') };
    const name = `Examen para modal ${Date.now()}`;
    const created = await instructor.request.post('/api/examenes/', { headers, data: { nombre: name, categoria: 'A1/A3', activo: true, num_preguntas: 1 } });
    expect(created.status()).toBe(201);
    const examId = (await created.json()).id;
    try {
    await login(page, 'alumno');
    await section(page, 'Exámenes');
    await page.locator('.glass-card').filter({ has: page.getByText(name, { exact: true }) }).getByRole('button', { name: 'Iniciar examen', exact: true }).click();
    const setup = page.getByRole('dialog', { name: 'Configurar examen', exact: true });
    await verifyDialog(page, setup, setup.getByRole('button', { name: 'Comenzar examen', exact: true }));
    await page.keyboard.press('Escape');
    await section(page, 'Chat');
    const message = `Mensaje para comprobar la confirmación de limpieza ${Date.now()}.`;
    await page.getByPlaceholder('Escribe un mensaje...').fill(message);
    await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await expect(page.getByTitle('Limpiar conversación', { exact: true })).toHaveCount(0);
    await section(instructor, 'Chat');
    await instructor.locator('main button').filter({ has: instructor.getByText('E2E Alumno', { exact:true }) }).filter({ visible:true }).click();
    const conversation = instructor.getByRole('region', { name:'Conversación con E2E Alumno', exact:true });
    await conversation.getByRole('button', { name:'Limpiar conversación', exact:true }).click();
    const clear = instructor.getByRole('dialog', { name: 'Limpiar chat', exact: true });
    await verifyDialog(instructor, clear, clear.getByRole('button', { name: 'Cancelar', exact: true }));
    await instructor.keyboard.press('Escape');
    await expect(clear).toHaveCount(0);
    } finally {
      expect((await instructor.request.delete(`/api/examenes/${examId}/`, { headers })).status()).toBe(204);
      await staffContext.close();
    }
  });

  test('admin dashboard counters follow published courses and overlapping roles', async ({ page }) => {
    await login(page, 'admin');
    const headers = { 'X-UASSpain-Window-Id': await page.evaluate(() => sessionStorage.getItem('uasspain.window_session_id') || '') };
    const before = await (await page.request.get('/api/system/status/', { headers })).json();
    const response = await page.request.post('/api/admin/courses', { headers, data: {
      name: 'Panel counter fixture', description: 'Counter course fixture', category: 'other', modality: 'online', slug: `panel-counter-${Date.now()}`, status: 'published',
    } });
    expect(response.status()).toBe(201);
    const course = await response.json();
    try {
      await page.reload();
      const status = await (await page.request.get('/api/system/status/', { headers })).json();
      expect(status.academic.published_courses).toBe(before.academic.published_courses + 1);
      const counts = [
        ['Cursos publicados', status.academic.published_courses], ['Total usuarios', status.users.total],
        ['Administradores activos', status.users.admin], ['Instructores activos', status.users.instructor],
        ['Alumnos activos', status.users.alumno], ['Exámenes aprobados', status.academic.passed_exams],
      ];
      for (const [label, value] of counts) {
        await expect(page.getByText(String(label), { exact: true }).locator('..').getByText(String(value), { exact: true })).toBeVisible();
      }
      await page.route('**/api/system/status/', route => route.fulfill({ status: 503, json: { detail: 'fixture unavailable' } }));
      // The dashboard refreshes every 30 seconds; preserve the mounted data
      // while exercising that real refresh instead of reloading the document.
      await expect(page.getByRole('alert')).toContainText(/no se pudieron actualizar/i, { timeout: 40000 });
      await expect(page.getByText('Cursos publicados', { exact:true }).locator('..').getByText(String(status.academic.published_courses), { exact:true })).toBeVisible();
      await page.unroute('**/api/system/status/');
      await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveCount(0);
    } finally {
      expect((await page.request.delete(`/api/admin/courses/${course.id}`, { headers })).status()).toBe(204);
    }
  });

  test('admin publishes, edits and removes news with a real image through the UI', async ({ page }) => {
    await login(page, 'admin');
    const headers = { 'X-UASSpain-Window-Id': await page.evaluate(() => sessionStorage.getItem('uasspain.window_session_id') || '') };
    await section(page, 'Blog / Publicaciones');
    const title = `Panel news ${Date.now()}`;
    let postId: string | undefined;
    try {
      await page.getByLabel('Título de la publicación').fill(title);
      await page.getByLabel('Contenido de la publicación').fill('Texto de prueba con persistencia real.');
      await page.locator('input[type=file]').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
      await page.getByRole('button', { name: 'Publicar', exact: true }).first().click();
      const article = page.getByRole('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
      await expect(article).toBeVisible();
      const posts = await (await page.request.get('/api/admin/blog/posts', { headers })).json();
      const post = posts.find(item => item.title === title);
      postId = post.id;
      expect(post.images).toHaveLength(1);
      await expect(article.locator('img')).toBeVisible();
      await expect.poll(() => article.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      expect((await (await page.request.get('/api/blog/posts')).json()).some(item => item.id === postId)).toBe(true);
      await article.getByRole('button', { name: 'Editar', exact: true }).click();
      await page.getByLabel('Contenido de la publicación').fill('Contenido actualizado desde el panel.');
      await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
      await expect(article).toContainText('Contenido actualizado desde el panel.');
      await article.getByRole('button', { name: 'Despublicar', exact: true }).click();
      await expect(article.getByText('Borrador', { exact: true })).toBeVisible();
      expect((await (await page.request.get('/api/blog/posts')).json()).some(item => item.id === postId)).toBe(false);
      await article.getByRole('button', { name: 'Eliminar', exact: true }).click();
      const confirm = page.getByRole('alertdialog');
      await page.setViewportSize({ width: 320, height: 568 });
      await expect(confirm.getByRole('button', { name: 'Eliminar bloque', exact: true })).toBeInViewport();
      await confirm.getByRole('button', { name: 'Eliminar bloque', exact: true }).click();
      await expect(article).toHaveCount(0);
      expect((await (await page.request.get('/api/admin/blog/posts', { headers })).json()).some(item => item.id === postId)).toBe(false);
      postId = undefined;
    } finally {
      if (postId) await page.request.delete(`/api/admin/blog/posts/${postId}`, { headers });
    }
  });
});
