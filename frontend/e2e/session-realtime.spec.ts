import { expect, test, type Page } from '@playwright/test';

const accounts = [
  { role: 'admin', email: 'e2e-admin@test.local', password: 'E2eAdmin_2026!' }, // pragma: allowlist secret - isolated fixture
  { role: 'instructor', email: 'instructor.e2e@test.local', password: 'E2eInstr_2026!' }, // pragma: allowlist secret - isolated fixture
  { role: 'alumno', email: 'alumno.e2e@test.local', password: 'E2ePass_2026!' }, // pragma: allowlist secret - isolated fixture
  { role: 'alumno', email: 'segundo.e2e@test.local', password: 'E2eSecond_2026!' }, // pragma: allowlist secret - isolated fixture
];
const nav = (page: Page) => page.locator('aside:visible nav');
const binding = (page: Page) => page.evaluate(() => sessionStorage.getItem('uasspain.window_session_id'));
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Videollamada UASSPAIN', exact: true });
const message = (page: Page, text: string) => page.locator('main p.whitespace-pre-wrap').and(page.getByText(text, { exact: true })).filter({ visible: true });
type ObservedWindow = Window & { auditSockets: WebSocket[]; auditTracks: MediaStreamTrack[]; auditPeers: RTCPeerConnection[] };

async function login(page: Page, account: typeof accounts[number]) {
  await page.goto('/?auth=login');
  await page.getByLabel('Correo electrónico *', { exact: true }).fill(account.email);
  await page.getByLabel('Contraseña *', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${account.role}$`));
  await expect(page.locator('header h1')).toHaveText('Dashboard');
  const headers = { Origin: new URL(page.url()).origin, 'X-UASSpain-Window-Id': await binding(page) || '' };
  const response = await page.request.get('/api/auth/me/', { headers });
  expect(response.status()).toBe(200);
  return { headers, profile: (await response.json()).profile };
}

test('@session-regression refresh, full navigation, token renewal and temporary API failures preserve all three roles', async ({ browser }) => {
  for (const account of accounts.slice(0, 3)) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await login(page, account);
      const id = await binding(page);
      for (let count = 0; count < 3; count++) {
        await page.reload();
        await expect(page.locator('header h1')).toHaveText('Dashboard');
        expect(await binding(page)).toBe(id);
      }
      await page.goto('/tecnologia');
      await page.goto(`/${account.role}`);
      await expect(page.locator('header h1')).toHaveText('Dashboard');
      expect(await binding(page)).toBe(id);
      await context.clearCookies({ name: 'uasspain_access' });
      const renewal = page.waitForResponse(r => r.url().includes('/api/auth/refresh/') && r.status() === 200);
      await page.reload(); await renewal;
      await expect(page.locator('header h1')).toHaveText('Dashboard');
      expect(await binding(page)).toBe(id);
      const sessionEndpoint = (url: URL) => url.pathname === '/api/auth/me/';
      await page.route(sessionEndpoint, route => route.fulfill({ status: 503, json: { detail: 'Temporary isolated API failure' } }));
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Comprobando sesión' })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/${account.role}$`));
      expect(await binding(page)).toBe(id);
      await page.unroute(sessionEndpoint);
      await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
      await expect(page.locator('header h1')).toHaveText('Dashboard');
    } finally { await context.close(); }
  }
});

test('@session-regression browsers without ownership APIs retain refresh while a copied live tab remains unauthenticated', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
    Object.defineProperty(window, 'BroadcastChannel', { value: undefined, configurable: true });
  });
  try {
    const page = await context.newPage(); await login(page, accounts[1]);
    const id = await binding(page);
    for (let count = 0; count < 3; count++) {
      await page.reload(); await expect(page.locator('header h1')).toHaveText('Dashboard');
      expect(await binding(page)).toBe(id);
    }
    const copied = await context.newPage();
    await copied.addInitScript(id => {
      if (!sessionStorage.getItem('copied-fixture-initialized')) {
        sessionStorage.setItem('uasspain.window_session_id', id);
        sessionStorage.setItem('copied-fixture-initialized', '1');
      }
    }, id!);
    await copied.goto('/instructor');
    await expect(copied).toHaveURL(/auth=login/);
    await expect(copied.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeVisible();
    await expect.poll(() => binding(copied)).not.toBe(id);
    await page.reload(); await expect(page.locator('header h1')).toHaveText('Dashboard');
    expect(await binding(page)).toBe(id);
  } finally { await context.close(); }
});

test('@realtime-regression bidirectional chats, broadcasts, read receipts, reconnection and real media work together through production HTTPS', async ({ browser }) => {
  test.setTimeout(240_000);
  const contexts = await Promise.all(accounts.map(() => browser.newContext({ permissions: ['camera', 'microphone'] })));
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const errors: string[] = [];
  const socketErrors: string[] = [];
  const navigations: number[] = [0, 0, 0, 0];
  try {
    for (const [index, page] of pages.entries()) {
      page.on('pageerror', e => errors.push(e.message));
      page.on('websocket', socket => socket.on('socketerror', error => socketErrors.push(error)));
      page.on('request', r => { if (r.isNavigationRequest() && r.frame() === page.mainFrame()) navigations[index]++; });
      await page.addInitScript(() => {
        const observed = window as ObservedWindow;
        observed.auditSockets = []; observed.auditTracks = []; observed.auditPeers = [];
        const Socket = window.WebSocket;
        window.WebSocket = class extends Socket { constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); observed.auditSockets.push(this); } };
        const Peer = window.RTCPeerConnection;
        window.RTCPeerConnection = class extends Peer { constructor(config?: RTCConfiguration) { super(config); observed.auditPeers.push(this); } };
        const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async constraints => { const stream = await getMedia(constraints); observed.auditTracks.push(...stream.getTracks()); return stream; };
      });
    }
    const identities = [];
    for (const [index, page] of pages.entries()) identities.push(await login(page, accounts[index]));
    const [admin, instructor, student, second] = pages;
    await instructor.setViewportSize({ width: 1440, height: 1000 });
    for (const page of pages) {
      await nav(page).getByRole('button', { name: 'Chat', exact: true }).click();
      await nav(page).getByRole('button', { name: 'Videollamada', exact: true }).click();
      await nav(page).getByRole('button', { name: 'Chat', exact: true }).click();
    }
    const selectStudent = () => instructor.locator('main button').filter({ has: instructor.getByText('E2E Alumno', { exact: true }) }).filter({ visible: true }).click();
    const firstChat = instructor.getByRole('region', { name: 'Conversación con E2E Alumno', exact: true });
    const secondChat = instructor.getByRole('region', { name: 'Conversación con E2E Segundo', exact: true });
    await selectStudent();
    const send = async (page: Page, message: string) => {
      const scope = page === instructor && await firstChat.isVisible() ? firstChat : page;
      await scope.getByPlaceholder('Escribe un mensaje...').filter({ visible: true }).fill(message);
      await scope.getByRole('button', { name: 'Enviar mensaje', exact: true }).filter({ visible: true }).click();
    };
    const checkpoint = [...navigations];
    const outbound = `Directo instructor ${Date.now()}`;
    await send(instructor, outbound);
    await expect(message(student, outbound)).toBeVisible({ timeout: 5000 });
    await expect(message(second, outbound)).toHaveCount(0);
    const reply = `Directo alumno ${Date.now()}`;
    await send(student, reply);
    await expect(message(instructor, reply)).toBeVisible({ timeout: 5000 });
    // Each open student has a separate draft and receives concurrently.
    await firstChat.getByPlaceholder('Escribe un mensaje...').fill('Borrador privado del primer alumno');
    await instructor.locator('main button').filter({ has: instructor.getByText('E2E Segundo', { exact: true }) }).filter({ visible: true }).click();
    await expect(firstChat).toBeVisible(); await expect(secondChat).toBeVisible();
    await secondChat.getByPlaceholder('Escribe un mensaje...').fill('Borrador privado del segundo alumno');
    await expect(firstChat.getByPlaceholder('Escribe un mensaje...')).toHaveValue('Borrador privado del primer alumno');
    const simultaneous = [`Alumno uno paralelo ${Date.now()}`, `Alumno dos paralelo ${Date.now()}`];
    await Promise.all([send(student, simultaneous[0]), send(second, simultaneous[1])]);
    await expect(firstChat.getByText(simultaneous[0], { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(secondChat.getByText(simultaneous[1], { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(firstChat.getByText(simultaneous[1], { exact: true })).toHaveCount(0);
    await expect(secondChat.getByText(simultaneous[0], { exact: true })).toHaveCount(0);
    await expect(secondChat.getByPlaceholder('Escribe un mensaje...')).toHaveValue('Borrador privado del segundo alumno');
    const boxes = await Promise.all([firstChat.boundingBox(), secondChat.boundingBox()]);
    expect(boxes[0]!.y).toBe(boxes[1]!.y);
    expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
    await instructor.screenshot({ path: '../.run/parallel-chat-desktop.png', fullPage: true });
    await instructor.setViewportSize({ width: 390, height: 844 });
    expect(await instructor.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await instructor.screenshot({ path: '../.run/parallel-chat-mobile.png', fullPage: true });
    await instructor.setViewportSize({ width: 1440, height: 1000 });
    // Delay one response: the other chat must still send successfully. Closing
    // the first chat before its response arrives must not affect the second.
    const delayedText = `Respuesta retrasada ${Date.now()}`;
    let releaseResponse!: () => void;
    let savedResponse!: () => void;
    const delayed = new Promise<void>(resolve => { releaseResponse = resolve; });
    const saved = new Promise<void>(resolve => { savedResponse = resolve; });
    await instructor.route('**/api/mensajes/', async route => {
      if (route.request().method() === 'POST' && route.request().postDataJSON()?.contenido === delayedText) {
        const response = await route.fetch(); savedResponse(); await delayed;
        await route.fulfill({ response });
      } else await route.continue();
    });
    await send(instructor, delayedText); await saved;
    const independent = `Envío independiente ${Date.now()}`;
    await secondChat.getByPlaceholder('Escribe un mensaje...').fill(independent);
    await secondChat.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
    await expect(message(second, independent)).toBeVisible({ timeout: 5000 });
    await expect(secondChat.getByRole('button', { name: 'Enviar mensaje', exact: true })).toBeDisabled();
    await firstChat.getByRole('button', { name: 'Cerrar chat con E2E Alumno', exact: true }).click();
    releaseResponse();
    await expect(firstChat).toHaveCount(0);
    await expect(instructor.locator('main p.whitespace-pre-wrap').filter({ hasText: delayedText, visible: true })).toHaveCount(0);
    await expect(message(student, delayedText)).toBeVisible();
    await expect(message(second, delayedText)).toHaveCount(0);
    await instructor.unroute('**/api/mensajes/'); await selectStudent();
    const group = `Difusión privada ${Date.now()}`;
    await instructor.getByRole('button', { name: 'Enviar a varios', exact: true }).filter({ visible: true }).click();
    await instructor.getByRole('button', { name: 'Seleccionar todos', exact: true }).filter({ visible: true }).click();
    await instructor.getByLabel('Escribe el mensaje para los destinatarios seleccionados…').filter({ visible: true }).fill(group);
    await instructor.getByRole('button', { name: 'Enviar a 2', exact: true }).filter({ visible: true }).click();
    for (const page of [student, second]) await expect(message(page, group)).toBeVisible({ timeout: 5000 });
    await instructor.getByRole('button', { name: 'Cerrar difusión' }).filter({ visible: true }).click();
    const retainedDraft = 'Borrador conservado al cambiar de sección';
    await secondChat.getByPlaceholder('Escribe un mensaje...').fill(retainedDraft);
    await instructor.getByRole('button', { name: 'Administración', exact: true }).click();
    const hiddenReply = `Alumno con chat oculto ${Date.now()}`;
    await send(student, hiddenReply);
    await expect.poll(async () => {
      const response = await instructor.request.get(`/api/mensajes/?alumno_id=${identities[2].profile.id}`, { headers: identities[1].headers });
      return (await response.json()).some(row => row.contenido === hiddenReply && row.leido_instructor === false);
    }).toBe(true);
    await instructor.getByRole('button').filter({ has: instructor.getByText('E2E Admin', { exact: true }) }).filter({ visible: true }).click();
    await admin.getByRole('button').filter({ has: admin.getByText('E2E Instructor', { exact: true }) }).click();
    const staffText = `Administración ${Date.now()}`;
    await send(admin, staffText);
    await expect(message(instructor, staffText)).toBeVisible({ timeout: 5000 });
    await send(instructor, staffText + ' respuesta');
    await expect(message(admin, staffText + ' respuesta')).toBeVisible({ timeout: 5000 });
    await instructor.locator('main').getByRole('button', { name: /^Alumnos(?:\s+\d+)?$/ }).filter({ visible: true }).click();
    await expect(firstChat.getByText(hiddenReply, { exact: true })).toBeVisible();
    await expect(secondChat.getByPlaceholder('Escribe un mensaje...')).toHaveValue(retainedDraft);
    expect(navigations).toEqual(checkpoint);
    // Delivery and read receipts are verified in persisted API rows, not just bubbles.
    await expect.poll(async () => {
      const response = await instructor.request.get(`/api/mensajes/?alumno_id=${identities[2].profile.id}`, { headers: identities[1].headers });
      const rows = await response.json();
      return rows.find(row => row.contenido === reply)?.leido_instructor === true && rows.find(row => row.contenido === outbound)?.leido_alumno === true;
    }).toBe(true);
    await expect.poll(async () => {
      const response = await admin.request.get(`/api/mensajes-staff/?peer_id=${identities[1].profile.id}`, { headers: identities[0].headers });
      return (await response.json()).find(row => row.contenido === staffText)?.leido_destinatario;
    }).toBe(true);
    for (const page of pages) await expect.poll(() => page.evaluate(() => (window as ObservedWindow).auditSockets.filter(s => s.readyState === WebSocket.OPEN && new URL(s.url).pathname === '/ws/conexiones/').length)).toBe(1);
    // Force a transport interruption; delivery must catch up without a page reload.
    await student.context().clearCookies({ name: 'uasspain_access' });
    const renewed = student.waitForResponse(r => r.url().includes('/api/auth/refresh/') && r.status() === 200);
    await student.evaluate(() => (window as ObservedWindow).auditSockets.filter(s => new URL(s.url).pathname.startsWith('/ws/chat/')).forEach(s => s.close()));
    await instructor.locator('main').getByRole('button', { name: /^Alumnos(?:\s+\d+)?$/ }).filter({ visible: true }).click(); await selectStudent();
    const resumed = `Tras reconexión ${Date.now()}`;
    await send(instructor, resumed);
    await renewed;
    await expect(message(student, resumed)).toBeVisible({ timeout: 8000 });
    expect(navigations).toEqual(checkpoint);
    await firstChat.getByRole('button', { name: 'Limpiar conversación', exact: true }).click();
    await instructor.getByRole('dialog', { name: 'Limpiar chat' }).getByRole('button', { name: 'Limpiar chat', exact: true }).click();
    await expect(message(student, outbound)).toHaveCount(0);
    await expect(message(student, resumed)).toHaveCount(0);
    await expect(secondChat.getByText(group, { exact: true })).toBeVisible();
    await expect(message(second, independent)).toBeVisible();
    await nav(instructor).getByRole('button', { name: 'Videollamada', exact: true }).click();
    for (const page of [student, second]) await nav(page).getByRole('button', { name: 'Videollamada', exact: true }).click();
    await instructor.getByRole('button', { name: 'Llamar a todos los alumnos', exact: true }).click();
    for (const page of [student, second]) await page.getByRole('button', { name: 'Unirse a la llamada', exact: true }).click();
    const media = async (page: Page, count: number) => {
      await expect(dialog(page).locator('video')).toHaveCount(count + 1);
      await expect.poll(() => page.evaluate(async () => {
        const reports = await Promise.all((window as ObservedWindow).auditPeers.filter(p => p.connectionState !== 'closed').map(p => p.getStats()));
        return reports.filter(report => ['audio', 'video'].every(kind => Array.from(report.values()).some(stat => stat.type === 'inbound-rtp' && stat.kind === kind && stat.bytesReceived > 0 && (kind !== 'video' || stat.framesDecoded > 0)))).length;
      }), { timeout: 30000 }).toBe(count);
    };
    for (const page of [instructor, student, second]) await media(page, 2);
    await student.getByRole('button', { name: 'Silenciar micrófono' }).click();
    await student.getByRole('button', { name: 'Apagar cámara' }).click();
    await expect.poll(() => student.evaluate(() => (window as ObservedWindow).auditTracks.every(t => !t.enabled))).toBe(true);
    await student.getByRole('button', { name: 'Activar micrófono' }).click();
    await student.getByRole('button', { name: 'Activar cámara' }).click();
    // Require a new socket and new peer connections before checking RTP again.
    // Four separate recoveries also catch a retry counter that never resets.
    for (let cycle = 0; cycle < 4; cycle++) {
      const previous = await student.evaluate(() => {
        const observed = window as ObservedWindow;
        const counts = { sockets: observed.auditSockets.length, peers: observed.auditPeers.length };
        observed.auditSockets.filter(s => new URL(s.url).pathname.startsWith('/ws/videollamada/') && s.readyState === WebSocket.OPEN).forEach(s => s.close());
        return counts;
      });
      await expect.poll(() => student.evaluate(previous => {
        const observed = window as ObservedWindow;
        return observed.auditSockets.slice(previous.sockets).some(s => new URL(s.url).pathname.startsWith('/ws/videollamada/') && s.readyState === WebSocket.OPEN)
          && observed.auditPeers.slice(0, previous.peers).every(p => p.connectionState === 'closed')
          && observed.auditPeers.slice(previous.peers).filter(p => p.connectionState !== 'closed').length === 2;
      }, previous), { timeout: 15000 }).toBe(true);
      for (const page of [instructor, student, second]) await media(page, 2);
    }
    await dialog(student).getByRole('button', { name: 'Colgar', exact: true }).click();
    await media(instructor, 1); await media(second, 1);
    await expect.poll(() => student.evaluate(() => (window as ObservedWindow).auditTracks.every(t => t.readyState === 'ended'))).toBe(true);
    await dialog(instructor).getByRole('button', { name: 'Colgar', exact: true }).click();
    await expect(dialog(second)).toHaveCount(0);
    await nav(admin).getByRole('button', { name: 'Videollamada', exact: true }).click();
    await instructor.getByRole('tab', { name: 'Administradores', exact: true }).click();
    await admin.getByRole('button', { name: 'Llamar', exact: true }).filter({ visible: true }).click();
    await expect(dialog(admin).getByText('Moderador', { exact: true })).toBeVisible();
    await instructor.getByRole('region', { name: 'Videollamadas con administradores' }).getByRole('button', { name: 'Unirse', exact: true }).click();
    await expect(dialog(instructor).getByText('Participante', { exact: true })).toBeVisible();
    await media(admin, 1); await media(instructor, 1);
    const calls = await admin.request.get('/api/videollamadas/?canal=administracion&estado=activa', { headers: identities[0].headers });
    const [staffCall] = await calls.json();
    expect((await student.request.get(`/api/videollamadas/${staffCall.id}/`, { headers: identities[2].headers })).status()).toBe(403);
    await dialog(admin).getByRole('button', { name: 'Colgar', exact: true }).click();
    await expect(dialog(instructor)).toHaveCount(0);
    for (const page of pages) await expect.poll(() => page.evaluate(() => (window as ObservedWindow).auditTracks.every(t => t.readyState === 'ended'))).toBe(true);
    expect(navigations).toEqual(checkpoint);
    expect(errors).toEqual([]); expect(socketErrors).toEqual([]);
  } finally { await Promise.allSettled(contexts.map(context => context.close())); }
});
