import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email: string, password: string, route: string) {
  await page.goto('/?auth=login');
  await page.getByLabel('Correo electrónico *', { exact: true }).fill(email);
  await page.getByLabel('Contraseña *', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${route}$`));
  const headers = {
    Origin: 'http://127.0.0.1:8011',
    'X-UASSpain-Window-ID': await page.evaluate(() => sessionStorage.getItem('uasspain.window_session_id') || ''),
  };
  const result = await page.request.get('/api/auth/me/', { headers });
  expect(result.status()).toBe(200);
  const user = await result.json();
  return { headers, profile: user.profile ?? user };
}

const nav = (page: Page) => page.locator('aside:visible nav');
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Videollamada UASSPAIN', exact: true });

async function deniedSocket(page: Page, callId: string) {
  return page.evaluate(id => new Promise<boolean>(resolve => {
    const socket = new WebSocket(`ws://${location.host}/ws/videollamada/${id}/?window_id=${sessionStorage.getItem('uasspain.window_session_id')}`);
    const timer = setTimeout(() => { socket.close(); resolve(false); }, 5000);
    socket.onmessage = () => { clearTimeout(timer); socket.close(); resolve(false); };
    socket.onerror = () => { clearTimeout(timer); socket.close(); resolve(true); };
  }), callId);
}

test('all roles share accurate presence; staff and student calls are isolated and moderation follows the initiator', async ({ browser }) => {
  test.setTimeout(150_000);
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const [admin, instructor, student] = await Promise.all(contexts.map(context => context.newPage()));
  try {
    const [a, i, s] = await Promise.all([
      login(admin, 'e2e-admin@test.local', 'E2eAdmin_2026!', 'admin'), // pragma: allowlist secret - isolated fixture
      login(instructor, 'instructor.e2e@test.local', 'E2eInstr_2026!', 'instructor'), // pragma: allowlist secret - isolated fixture
      login(student, 'alumno.e2e@test.local', 'E2ePass_2026!', 'alumno'), // pragma: allowlist secret - isolated fixture
    ]);
    await expect(nav(instructor).getByRole('button', { name: 'Alumnos', exact: true })).toBeVisible();
    await expect(nav(instructor).getByRole('button', { name: 'Usuarios', exact: true })).toHaveCount(0);
    await nav(instructor).getByRole('button', { name: 'Conexiones activas', exact: true }).click();
    const presence = instructor.getByRole('region', { name: 'Conexiones activas', exact: true });
    for (const name of ['E2E Admin', 'E2E Instructor', 'E2E Alumno']) await expect(presence.getByRole('cell', { name, exact: true })).toBeVisible();
    const onlineResponse = await instructor.request.get('/api/registros-conexion/activas/', { headers: i.headers });
    expect(onlineResponse.status()).toBe(200);
    for (const session of await onlineResponse.json()) {
      expect(session).not.toHaveProperty('session_id');
      expect(session).not.toHaveProperty('direccion_ip');
      expect(session).not.toHaveProperty('email');
    }
    // Presence never grants permission to manage an administrator's session.
    const administratorSession = (await onlineResponse.json()).find(row => row.profile_id === a.profile.id);
    expect((await instructor.request.patch(`/api/registros-conexion/${administratorSession.id}/`, {
      headers: i.headers, data: { estado_sesion: 'finalizada' },
    })).status()).toBe(403);
    await nav(instructor).getByRole('button', { name: 'Chat', exact: true }).click();
    await instructor.getByRole('button', { name: 'Administración', exact: true }).click();
    const contact = instructor.getByRole('button').filter({ has: instructor.getByText('E2E Admin', { exact: true }) });
    await expect(contact.locator('[title="Conectado"]')).toBeVisible();
    await contact.click();
    await instructor.getByPlaceholder('Escribe un mensaje...').filter({ visible: true }).fill('Presencia y chat verificados');
    await instructor.getByRole('button', { name: 'Enviar mensaje', exact: true }).filter({ visible: true }).click();
    await nav(admin).getByRole('button', { name: 'Chat', exact: true }).click();
    await admin.getByRole('button').filter({ has: admin.getByText('E2E Instructor', { exact: true }) }).click();
    await expect(admin.getByText('Presencia y chat verificados', { exact: true })).toBeVisible();

    await nav(instructor).getByRole('button', { name: 'Videollamada', exact: true }).click();
    await expect(instructor.getByRole('region', { name: 'Videollamadas con alumnos' }).getByText('E2E Instructor', { exact: true })).toHaveCount(0);
    await instructor.getByRole('tab', { name: 'Administradores', exact: true }).click();
    const staffArea = instructor.getByRole('region', { name: 'Videollamadas con administradores' });
    await expect(staffArea.getByText('E2E Admin', { exact: true })).toBeVisible();
    await staffArea.getByRole('button', { name: 'Llamar', exact: true }).click();
    await expect(dialog(instructor).getByText('Moderador', { exact: true })).toBeVisible();
    await nav(admin).getByRole('button', { name: 'Videollamada', exact: true }).click();
    await admin.getByRole('button', { name: 'Unirse', exact: true }).filter({ visible: true }).click();
    await expect(dialog(admin).getByText('Participante', { exact: true })).toBeVisible();
    await expect(dialog(instructor).locator('video')).toHaveCount(2);
    await expect(dialog(admin).locator('video')).toHaveCount(2);
    const staffResponse = await instructor.request.get('/api/videollamadas/?canal=administracion&estado=activa', { headers: i.headers });
    const [staff] = await staffResponse.json();
    expect(staff.moderador_id).toBe(i.profile.id);
    expect(staff.alumno_id).toBeNull();
    expect((await student.request.get(`/api/videollamadas/${staff.id}/`, { headers: s.headers })).status()).toBe(403);
    expect(await deniedSocket(student, staff.id)).toBe(true);
    expect((await student.request.post('/api/videollamadas/', { headers: s.headers,
      data: { canal: 'administracion', administrador_id: a.profile.id, estado: 'activa' },
    })).status()).toBe(403);
    expect((await instructor.request.post('/api/videollamadas/', { headers: i.headers,
      data: { canal: 'administracion', administrador_id: i.profile.id, estado: 'activa' },
    })).status()).toBe(400);
    // A simultaneous classroom remains separate and invisible to other roles.
    const classroomResponse = await instructor.request.post('/api/videollamadas/', { headers: i.headers,
      data: { alumno_id: s.profile.id, estado: 'activa' },
    });
    expect(classroomResponse.status()).toBe(201);
    const classroom = await classroomResponse.json();
    expect(classroom.room_id).not.toBe(staff.room_id);
    expect(classroom.moderador_id).toBe(i.profile.id);
    expect((await admin.request.get(`/api/videollamadas/${classroom.id}/`, { headers: a.headers })).status()).toBe(403);
    expect(await deniedSocket(admin, classroom.id)).toBe(true);
    await dialog(instructor).getByRole('button', { name: 'Colgar', exact: true }).click();
    await expect(dialog(admin)).toHaveCount(0);
    expect((await instructor.request.get(`/api/videollamadas/${classroom.id}/`, { headers: i.headers })).status()).toBe(200);
    await instructor.getByRole('tab', { name: 'Alumnos', exact: true }).click();
    await instructor.getByRole('button', { name: 'Unirse', exact: true }).filter({ visible: true }).click();
    await nav(student).getByRole('button', { name: 'Videollamada', exact: true }).click();
    await student.getByRole('button', { name: 'Unirse a la llamada', exact: true }).click();
    await expect(dialog(instructor).locator('video')).toHaveCount(2);
    await expect(dialog(student).getByText('Participante', { exact: true })).toBeVisible();
    await dialog(instructor).getByRole('button', { name: 'Colgar', exact: true }).click();
    await expect(dialog(student)).toHaveCount(0);
    await expect(student.getByRole('button', { name: 'Iniciar videollamada', exact: true })).toBeVisible();
    // Reverse direction: the administrator becomes moderator without hardcoded role logic.
    await admin.getByRole('button', { name: 'Llamar', exact: true }).filter({ visible: true }).click();
    await expect(dialog(admin).getByText('Moderador', { exact: true })).toBeVisible();
    await instructor.getByRole('tab', { name: 'Administradores', exact: true }).click();
    await staffArea.getByRole('button', { name: 'Unirse', exact: true }).click();
    await expect(dialog(instructor).getByText('Participante', { exact: true })).toBeVisible();
    await expect(dialog(admin).locator('video')).toHaveCount(2);
    await dialog(admin).getByRole('button', { name: 'Colgar', exact: true }).click();
    await expect(dialog(instructor)).toHaveCount(0);
    // Logout is immediately reflected by both shared presence and the chat badge.
    expect((await admin.request.post('/api/auth/logout/', { headers: a.headers, data: {} })).status()).toBe(200);
    await nav(instructor).getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(contact.locator('[title="Desconectado"]')).toBeVisible();
    await nav(instructor).getByRole('button', { name: 'Conexiones activas', exact: true }).click();
    await expect(presence.getByRole('cell', { name: 'E2E Admin', exact: true })).toHaveCount(0);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
