import { test, expect, type Page } from '@playwright/test';

// These accounts exist only in the isolated Compose project prepared by run-e2e.ps1.
const roles = [
  { role: 'admin', email: 'e2e-admin@test.local', password: 'E2eAdmin_2026!', sections: [ // pragma: allowlist secret - isolated fixture
    'Dashboard', 'Actividad en tiempo real', 'Estadísticas', 'Conexiones en vivo',
    'Registro de Conexiones', 'Seguridad', 'Auditoría', 'Chat', 'Gestión de Usuarios',
    'Instructores', 'Blog / Publicaciones', 'Formación / Cursos', 'Monitorización',
    'Notificaciones', 'Backups', 'VPN', 'Configuración', 'Mi cuenta',
  ] },
  { role: 'instructor', email: 'instructor.e2e@test.local', password: 'E2eInstr_2026!', sections: [ // pragma: allowlist secret - isolated fixture
    'Dashboard', 'Usuarios', 'Exámenes', 'Material', 'Resultados', 'Estadísticas',
    'Chat', 'Videollamada', 'Conexiones activas', 'Cuenta',
  ] },
  { role: 'alumno', email: 'alumno.e2e@test.local', password: 'E2ePass_2026!', sections: [ // pragma: allowlist secret - isolated fixture
    'Dashboard', 'Exámenes', 'Resultados', 'Material', 'Evolución', 'Chat', 'Videollamada', 'Mi cuenta',
  ] },
];

async function login(page: Page, account: typeof roles[number]) {
  await page.goto('/?auth=login');
  await page.getByLabel('Correo electrónico *', { exact: true }).fill(account.email);
  await page.getByLabel('Contraseña *', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${account.role}$`));
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
}

for (const account of roles) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`${account.role}: navigation, persistence and logout at ${viewport.width}px`, async ({ page }, testInfo) => {
      test.setTimeout(180_000);
      await page.setViewportSize(viewport);
      const errors: string[] = [];
      let authenticated = false;
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (authenticated && message.type() === 'error') errors.push(message.text()); });
      page.on('response', response => { if ((authenticated && response.status() >= 400) || response.status() >= 500) errors.push(`${response.status()} ${response.url()}`); });
      await login(page, account);
      authenticated = true;
      await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true });
      for (const section of account.sections) {
        if (viewport.width < 1024) await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
        await page.locator('aside:visible nav').getByRole('button', { name: section, exact: true }).click();
        await expect(page.locator('header h1')).toHaveText(section);
        await expect(page.getByText('Se ha producido un error', { exact: false })).toHaveCount(0);
        if (viewport.width === 1440) {
          for (const width of [320, 360, 375, 390, 412, 480, 768, 820, 1024, 1280, 1366, 1440, 1920, 2560]) {
            await page.setViewportSize({ width, height: 900 });
            await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), { message: `${section} at ${width}px` }).toBe(true);
          }
          await page.setViewportSize(viewport);
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        expect(overflow, `${section}: horizontal overflow`).toBe(false);
      }
      await page.reload();
      await expect(page.locator('header h1')).toHaveText('Dashboard');
      authenticated = false;
      await page.getByRole('button', { name: 'Menú de cuenta', exact: true }).click();
      await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
      await expect(page).toHaveURL(/\/$/);
      await login(page, account);
      authenticated = true;
      await expect(page.locator('header h1')).toHaveText('Dashboard');
      expect(errors).toEqual([]);
    });
  }
}

test('student cannot enter administration', async ({ page }) => {
  await login(page, roles[2]);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Acceso denegado' })).toBeVisible();
  const response = await page.request.get('/api/backups/config/');
  expect(response.status()).toBe(403);
});

test('chat messages appear bidirectionally without a page reload', async ({ browser }) => {
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({ baseURL: 'http://127.0.0.1:8011' })));
  try {
    const instructor = await contexts[0].newPage();
    const student = await contexts[1].newPage();
    await login(instructor, roles[1]);
    await login(student, roles[2]);
    for (const page of [instructor, student]) await page.locator('aside:visible nav').getByRole('button', { name: 'Chat', exact: true }).click();
    await instructor.locator('main button').filter({ has: instructor.getByText('E2E Alumno', { exact: true }) }).click();
    const outgoing = `Mensaje instructor ${Date.now()}`;
    await instructor.getByPlaceholder('Escribe un mensaje...').filter({ visible: true }).fill(outgoing);
    await instructor.getByRole('button', { name: 'Enviar mensaje', exact: true }).filter({ visible: true }).click();
    await expect(student.getByText(outgoing, { exact: true })).toBeVisible({ timeout: 5000 });
    const reply = `Respuesta alumno ${Date.now()}`;
    await student.getByPlaceholder('Escribe un mensaje...').fill(reply);
    await student.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
    await expect(instructor.getByText(reply, { exact: true }).filter({ visible: true })).toBeVisible({ timeout: 5000 });
    await student.reload();
    await student.locator('aside:visible nav').getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(student.getByText(reply, { exact: true })).toBeVisible();
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('three participants exchange real WebRTC media and release devices on hangup', async ({ browser }) => {
  test.setTimeout(120_000);
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext({
    baseURL: 'http://127.0.0.1:8011', permissions: ['camera', 'microphone'],
  })));
  try {
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    for (const page of pages) await page.addInitScript(() => {
      const observed = window as Window & { auditTracks: MediaStreamTrack[]; auditPeers: RTCPeerConnection[] };
      observed.auditTracks = [];
      observed.auditPeers = [];
      const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        const stream = await getMedia(constraints);
        observed.auditTracks.push(...stream.getTracks());
        return stream;
      };
      const Peer = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends Peer {
        constructor(config?: RTCConfiguration) { super(config); observed.auditPeers.push(this); }
      };
    });
    await login(pages[0], roles[1]);
    await login(pages[1], roles[2]);
    await login(pages[2], { ...roles[2], email: 'segundo.e2e@test.local', password: 'E2eSecond_2026!' }); // pragma: allowlist secret - isolated fixture
    for (const page of pages) await page.locator('aside:visible nav').getByRole('button', { name: 'Videollamada', exact: true }).click();
    await pages[0].getByRole('button', { name: 'Llamar a todos los alumnos', exact: true }).click();
    for (const page of pages.slice(1)) await page.getByRole('button', { name: 'Unirse a la llamada', exact: true }).click();
    for (const page of pages) {
      await expect(page.getByRole('dialog', { name: 'Videollamada UASSPAIN' }).locator('video')).toHaveCount(3);
      await expect.poll(() => page.evaluate(async () => {
        const observed = window as Window & { auditPeers: RTCPeerConnection[] };
        const stats = await Promise.all(observed.auditPeers.map(peer => peer.getStats()));
        return stats.filter(report => ['audio', 'video'].every(kind => Array.from(report.values()).some(stat =>
          stat.type === 'inbound-rtp' && stat.kind === kind && stat.bytesReceived > 0,
        ))).length;
      })).toBe(2);
      await expect(page.getByRole('alert')).toHaveCount(0);
    }
    await pages[1].getByRole('button', { name: 'Silenciar micrófono' }).click();
    await expect.poll(() => pages[1].evaluate(() => (window as Window & { auditTracks: MediaStreamTrack[] }).auditTracks
      .filter(track => track.kind === 'audio').every(track => !track.enabled))).toBe(true);
    await pages[1].getByRole('button', { name: 'Apagar cámara' }).click();
    await pages[1].getByRole('button', { name: 'Colgar', exact: true }).click();
    await expect(pages[1].getByRole('dialog', { name: 'Videollamada UASSPAIN' })).toHaveCount(0);
    await expect.poll(() => pages[1].evaluate(() => (window as Window & { auditTracks: MediaStreamTrack[] }).auditTracks
      .every(track => track.readyState === 'ended'))).toBe(true);
    await expect(pages[0].locator('video')).toHaveCount(2);
    await pages[0].getByRole('button', { name: 'Colgar', exact: true }).click();
    await expect.poll(() => pages[2].evaluate(() => (window as Window & { auditTracks: MediaStreamTrack[] }).auditTracks
      .every(track => track.readyState === 'ended')), { timeout: 45_000 }).toBe(true);
    const active = await pages[0].request.get('/api/videollamadas/?estado=activa');
    expect(await active.json()).toEqual([]);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('admin creates, publishes, edits and deletes a dynamic course from the UI', async ({ page }) => {
  await login(page, roles[0]);
  await page.locator('aside:visible nav').getByRole('button', { name: 'Formación / Cursos', exact: true }).click();
  const name = `Curso interfaz ${Date.now()}`;
  const slug = `curso-interfaz-${Date.now()}`;
  await page.getByPlaceholder('Nombre', { exact: true }).fill(name);
  await page.getByPlaceholder('slug-opcional').fill(slug);
  await page.getByPlaceholder('Descripción breve').fill('Curso creado desde administración.');
  await page.getByPlaceholder('Descripción completa').fill('Contenido público del curso de prueba.');
  await page.locator('main select').selectOption('published');
  const create = page.waitForResponse(response => response.url().endsWith('/api/admin/courses') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  const result = await create;
  expect(result.status()).toBe(201);
  const course = await result.json();
  try {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    const publicPage = await page.context().newPage();
    await publicPage.setViewportSize({ width: 1920, height: 1080 });
    await publicPage.goto('/');
    await publicPage.getByRole('button', { name: 'Formación', exact: true }).click();
    await expect(publicPage.getByRole('link', { name, exact: true })).toBeVisible();
    await publicPage.getByRole('link', { name, exact: true }).click();
    await expect(publicPage.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(publicPage.getByText('Contenido público del curso de prueba.', { exact: true })).toBeVisible();
    await publicPage.close();
    await page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) }).getByRole('button', { name: 'Editar', exact: true }).click();
    await page.getByPlaceholder('Nombre', { exact: true }).fill(`${name} editado`);
    const edit = page.waitForResponse(response => response.url().endsWith(`/api/admin/courses/${course.id}`) && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    expect((await edit).status()).toBe(200);
    const card = page.locator('article').filter({ has: page.getByRole('heading', { name: `${name} editado`, exact: true }) });
    await card.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await page.getByRole('button', { name: 'Eliminar curso', exact: true }).click();
    await expect(card).toHaveCount(0);
  } finally { await page.request.delete(`/api/admin/courses/${course.id}`, { timeout: 5000 }).catch(() => {}); }
});

test('student saves, resumes and submits an exam through the UI', async ({ browser }) => {
  const staffContext = await browser.newContext({ baseURL: 'http://127.0.0.1:8011' });
  const studentContext = await browser.newContext({ baseURL: 'http://127.0.0.1:8011' });
  let examId = '';
  try {
    const instructor = await staffContext.newPage();
    const student = await studentContext.newPage();
    await login(instructor, roles[1]);
    const created = await instructor.request.post('/api/examenes/', { data: {
      nombre: 'Examen UI persistencia', categoria: 'A1/A3', activo: true, num_preguntas: 1,
    } });
    expect(created.status()).toBe(201);
    examId = (await created.json()).id;
    const question = await instructor.request.post('/api/preguntas/', { data: {
      examen_id: examId, enunciado: 'Selecciona la respuesta correcta de esta prueba.',
      opcion_a: 'Respuesta de prueba correcta', opcion_b: 'Otra respuesta', opcion_c: 'Tercera', opcion_d: 'Cuarta',
      respuesta_correcta: 'a', orden: 1,
    } });
    expect(question.status()).toBe(201);
    await login(student, roles[2]);
    const start = async () => {
      await student.locator('aside:visible nav').getByRole('button', { name: 'Exámenes', exact: true }).click();
      await student.locator('.glass-card').filter({ has: student.getByText('Examen UI persistencia', { exact: true }) })
        .getByRole('button', { name: 'Iniciar examen' }).click();
      await student.getByRole('button', { name: /Libre Sin límite/ }).click();
      await student.getByRole('button', { name: 'Comenzar examen' }).click();
      await expect(student.getByText('Selecciona la respuesta correcta de esta prueba.', { exact: true })).toBeVisible();
    };
    await start();
    const saved = student.waitForResponse(response => response.url().includes('/api/intentos-examen/') && response.request().method() === 'PUT' && response.ok());
    await student.getByRole('button', { name: /Respuesta de prueba correcta/ }).click();
    await saved;
    await student.reload();
    await expect(student.locator('header h1')).toHaveText('Dashboard');
    await start();
    await expect(student.getByRole('button', { name: /Respuesta de prueba correcta/ })).toHaveAttribute('aria-pressed', 'true');
    const submission = student.waitForResponse(response => response.url().includes('/api/resultados-examen/') && response.request().method() === 'POST');
    await student.getByRole('button', { name: 'Finalizar examen', exact: true }).click();
    await student.getByRole('button', { name: 'Finalizar', exact: true }).last().click();
    const result = await (await submission).json();
    expect(result.nota).toBe(10);
    expect(result.aprobado).toBe(true);
    await student.reload();
    await expect(student.locator('header h1')).toHaveText('Dashboard');
    const persisted = await student.request.get(`/api/resultados-examen/?examen_id=${examId}`);
    expect((await persisted.json()).length).toBe(1);
  } finally {
    if (examId) await staffContext.request.delete(`/api/examenes/${examId}/`);
    await Promise.all([staffContext.close(), studentContext.close()]);
  }
});
