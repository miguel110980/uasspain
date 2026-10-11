import { expect, test, chromium } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('services, publications and courses synchronize across independent browsers without reload', { tag: '@content-module' }, async ({ page, browser, baseURL }) => {
  test.setTimeout(240000);
  expect(['https://localhost:8444', 'http://127.0.0.1:8011']).toContain(baseURL);
  const launchOptions = test.info().project.use.launchOptions;
  const otherBrowser = await chromium.launch(launchOptions);
  const publicContext = await otherBrowser.newContext({ baseURL, ignoreHTTPSErrors: test.info().project.use.ignoreHTTPSErrors, viewport: { width: 1440, height: 900 } });
  const visitor = await publicContext.newPage();
  const blog = await publicContext.newPage();
  const catalog = await publicContext.newPage();
  const secondTab = await page.context().newPage();
  const titles = `TEMP_${randomUUID().replaceAll('-', '')}`;
  const created: { kind: 'services' | 'posts' | 'courses'; id: string; slug?: string }[] = [];
  const socketFrames: unknown[] = [];
  visitor.on('websocket', socket => { if (socket.url().includes('/ws/public-content/')) socket.on('framereceived', event => { try { socketFrames.push(JSON.parse(String(event.payload))); } catch {} }); });
  const login = async (target: typeof page) => {
    await target.goto('/?auth=login', { waitUntil: 'domcontentloaded' });
    await target.getByLabel('Correo electrónico *', { exact: true }).fill('e2e-admin@test.local');
    await target.getByLabel('Contraseña *', { exact: true }).fill('E2eAdmin_2026!'); // pragma: allowlist secret - isolated fixture
    await target.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await expect(target).toHaveURL(/\/admin$/);
  };
  const nav = (target: typeof page) => target.locator('aside:visible nav');
  const headers = async () => ({ Origin: baseURL, 'X-UASSpain-Window-Id': await page.evaluate(() => sessionStorage.getItem('uasspain.window_session_id') || '') });
  const adminRoot = (kind: string) => `/api/admin/${kind === 'posts' ? 'blog/posts' : kind}`;
  const current = async (kind: string, id: string) => {
    const response = await page.request.get(adminRoot(kind), { headers: await headers() }); expect(response.status()).toBe(200);
    return (await response.json()).find(item => item.id === id);
  };
  const patch = async (kind: string, id: string, data: object) => {
    const item = await current(kind, id); const response = await page.request.patch(adminRoot(kind) + '/' + id, { headers: { ...await headers(), 'If-Match': String(item.version) }, data }); expect(response.status()).toBe(200); return response.json();
  };
  try {
    console.log('CONTENT_BROWSER_STEP=login');
    await login(page); await login(secondTab);
    await page.setViewportSize({ width: 1440, height: 900 }); await secondTab.setViewportSize({ width: 1440, height: 900 });
    await nav(page).getByRole('button', { name: 'Servicios', exact: true }).click();
    await nav(secondTab).getByRole('button', { name: 'Servicios', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Servicios guardados (7)', exact: true })).toBeVisible();
    await expect(secondTab.getByRole('heading', { name: 'Servicios guardados (7)', exact: true })).toBeVisible();
    await visitor.goto('/', { waitUntil: 'domcontentloaded' }); await visitor.locator('#servicios').scrollIntoViewIfNeeded();
    await expect(visitor.locator('[data-service-id]')).toHaveCount(7);
    await blog.goto('/blog', { waitUntil: 'domcontentloaded' }); await catalog.goto('/formacion', { waitUntil: 'domcontentloaded' });
    const navigations = { visitor: 0, blog: 0, catalog: 0 };
    visitor.on('request', request => { if (request.isNavigationRequest() && request.frame() === visitor.mainFrame()) navigations.visitor++; });
    blog.on('request', request => { if (request.isNavigationRequest() && request.frame() === blog.mainFrame()) navigations.blog++; });
    catalog.on('request', request => { if (request.isNavigationRequest() && request.frame() === catalog.mainFrame()) navigations.catalog++; });
    const documentOrigins = await Promise.all([visitor, blog, catalog].map(target => target.evaluate(() => performance.timeOrigin)));
    console.log('CONTENT_BROWSER_STEP=create');
    const form = page.getByRole('form', { name: 'Nuevo servicio', exact: true });
    await form.getByLabel('Título', { exact: true }).fill(titles + ' service');
    await form.getByLabel('Slug', { exact: true }).fill('temp-' + titles.toLowerCase().replaceAll('_', '-'));
    await form.getByLabel('Descripción corta', { exact: true }).fill('TEMP public summary');
    await form.getByLabel('Descripción completa', { exact: true }).fill('TEMP full service description');
    await form.getByLabel('Orden', { exact: true }).fill('100001');
    await form.getByRole('combobox', { name: 'Estado', exact: true }).selectOption('draft');
    expect(await form.evaluate(node => (node as HTMLFormElement).checkValidity())).toBe(true);
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/admin/services') && response.request().method() === 'POST', { timeout: 15000 });
    await form.getByRole('button', { name: 'Guardar servicio', exact: true }).click();
    const response = await responsePromise; expect(response.status()).toBe(201); const service = await response.json(); created.push({ kind: 'services', id: service.id, slug: service.slug });
    await expect(secondTab.getByRole('article').filter({ hasText: titles + ' service' })).toBeVisible({ timeout: 5000 });
    await expect(visitor.locator('[data-service-id="' + service.id + '"]')).toHaveCount(0);
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: titles + ' service', exact: true }) });
    await card.getByRole('button', { name: 'Publicar', exact: true }).click();
    await expect(visitor.locator('[data-service-id="' + service.id + '"]')).toBeAttached({ timeout: 5000 });
    const scrollBefore = await visitor.evaluate(() => scrollY);
    await patch('services', service.id, { title: titles + ' updated', short_description: 'TEMP changed summary' });
    await expect(visitor.locator('[data-service-id="' + service.id + '"]')).toContainText(titles + ' updated', { timeout: 5000 });
    expect(Math.abs(await visitor.evaluate(() => scrollY) - scrollBefore)).toBeLessThan(3);
    await expect(secondTab.getByRole('article').filter({ hasText: titles + ' updated' })).toBeVisible({ timeout: 5000 });
    await patch('services', service.id, { status: 'draft' });
    await expect(visitor.locator('[data-service-id="' + service.id + '"]')).toHaveCount(0, { timeout: 5000 });
    await patch('services', service.id, { status: 'published' });
    await expect(visitor.locator('[data-service-id="' + service.id + '"]')).toBeAttached({ timeout: 5000 });

    console.log('CONTENT_BROWSER_STEP=posts-courses');
    for (const [kind, data, observer, changed] of [
      ['posts', { title: titles + ' post', body: 'TEMP publication body', status: 'published', sort_order: 100001 }, blog, { body: 'TEMP publication edited' }],
      ['courses', { name: titles + ' course', slug: 'temp-course-' + titles.toLowerCase().replaceAll('_', '-'), description: 'TEMP course body', modality: 'online', category: 'other', status: 'published', sort_order: 100001 }, catalog, { name: titles + ' course edited', description: 'TEMP programme edited' }],
    ] as const) {
      const result = await page.request.post(adminRoot(kind), { headers: await headers(), data }); expect(result.status()).toBe(201); const item = await result.json(); created.push({ kind, id: item.id, slug: item.slug });
      await expect(observer.locator('main').getByText(kind === 'posts' ? titles + ' post' : titles + ' course', { exact: true })).toBeAttached({ timeout: 5000 });
      await patch(kind, item.id, changed);
      await expect(observer.locator('main').getByText(kind === 'posts' ? 'TEMP publication edited' : titles + ' course edited', { exact: true })).toBeAttached({ timeout: 5000 });
      await patch(kind, item.id, { status: 'draft' });
      await expect(observer.locator('main').getByText(kind === 'posts' ? titles + ' post' : titles + ' course edited', { exact: true })).toHaveCount(0, { timeout: 5000 });
      await patch(kind, item.id, { status: 'published' });
      await expect(observer.locator('main').getByText(kind === 'posts' ? titles + ' post' : titles + ' course edited', { exact: true })).toBeAttached({ timeout: 5000 });
    }
    await publicContext.setOffline(true);
    await patch('services', service.id, { title: titles + ' offline recovery' });
    await publicContext.setOffline(false);
    await expect(visitor.locator('[data-service-id="' + service.id + '"]')).toContainText(titles + ' offline recovery', { timeout: 8000 });
    expect(navigations).toEqual({ visitor: 0, blog: 0, catalog: 0 });
    expect(await Promise.all([visitor, blog, catalog].map(target => target.evaluate(() => performance.timeOrigin)))).toEqual(documentOrigins);
    expect(socketFrames.some(event => event?.type === 'content_changed')).toBe(true);

    for (const theme of ['light', 'dark']) for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(t => { document.documentElement.classList.toggle('dark', t === 'dark'); document.documentElement.style.colorScheme = t; }, theme);
      await expect(page.getByLabel('Título', { exact: true })).toBeAttached();
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) console.log('OVERFLOW_DIAG=' + JSON.stringify(await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, elements: Array.from(document.querySelectorAll('body *')).filter(node => node.getBoundingClientRect().right > innerWidth + 1).slice(-12).map(node => ({ tag: node.tagName, className: node.className, right: node.getBoundingClientRect().right, width: node.getBoundingClientRect().width })) }))));
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), { timeout: 3000, message: `No horizontal overflow at ${width}px in ${theme}` }).toBe(true);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await nav(page).getByRole('button', { name: 'Servicios', exact: true }).click();
    const updatedCard = page.getByRole('article').filter({ hasText: titles + ' offline recovery' });
    await updatedCard.getByRole('button', { name: 'Eliminar', exact: true }).click();
    const dialog = page.getByRole('alertdialog'); await dialog.getByRole('button', { name: 'Eliminar servicio', exact: true }).click();
    await expect(updatedCard).toHaveCount(0, { timeout: 5000 });
    await expect(secondTab.getByRole('article').filter({ hasText: titles + ' offline recovery' })).toHaveCount(0, { timeout: 5000 });
    await expect(visitor.locator('[data-service-id="' + service.id + '"]')).toHaveCount(0, { timeout: 5000 });
    await expect(visitor.locator('[data-service-id]')).toHaveCount(7);
    const administrator = await page.request.get('/api/auth/me/', { headers: await headers() }); expect(administrator.status()).toBe(200); expect((await administrator.json()).session_role).toBe('admin');
  } finally {
    await publicContext.setOffline(false);
    for (const item of created) {
      const record = await current(item.kind, item.id);
      if (record) expect((await page.request.delete(adminRoot(item.kind) + '/' + item.id, { headers: { ...await headers(), 'If-Match': String(record.version) } })).status()).toBe(204);
    }
    await otherBrowser.close(); await secondTab.close();
  }
});
