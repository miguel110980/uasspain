import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
// These helpers reject any database outside the disposable Compose project.
import { concurrentFixtures } from '../../scripts/e2e/concurrent-fixtures.mjs';

let seed: Awaited<ReturnType<typeof concurrentFixtures>>;
test.beforeAll(async () => { seed = await concurrentFixtures(8); });
test.afterAll(async () => { await seed?.cleanup(); });
const binding = (page: Page) => page.evaluate(() => sessionStorage.getItem('uasspain.window_session_id') || '');
async function login(page: Page, index: number) {
  const fixture = seed.fixtures[index];
  await page.goto('/?auth=login');
  await page.getByLabel('Correo electrónico *', { exact: true }).fill(fixture.email);
  await page.getByLabel('Contraseña *', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  if (index === 7) {
    await expect(page).toHaveURL(/elegir-panel/);
    await page.getByRole('button', { name: /Administrador/ }).click();
  }
  await expect(page.locator('header h1')).toHaveText('Dashboard');
}

test('@concurrent-regression panel data waits for the role mutation and fresh identity', async ({ page }) => {
  await login(page, 7);
  let pending = false, started = false;
  const premature: string[] = [];
  await page.route(url => url.pathname === '/api/auth/session-role/', async route => {
    pending = true; started = true;
    await new Promise(resolve => setTimeout(resolve, 1200));
    await route.continue();
    pending = false;
  });
  page.on('request', r => { const path = new URL(r.url()).pathname; if (pending && path.startsWith('/api/') && !path.startsWith('/api/auth/')) premature.push(path); });
  await page.goto('/instructor');
  await expect.poll(() => started).toBe(true);
  await expect(page.locator('header h1')).toHaveText('Dashboard');
  expect(premature).toEqual([]);
  const me = await page.request.get('/api/auth/me/', { headers: { 'X-UASSpain-Window-Id': await binding(page) } });
  expect((await me.json()).session_role).toBe('instructor');
});

test('@concurrent-regression one optional resource failure preserves successful dashboard resources', async ({ page }) => {
  // Deliberate failure injection, rather than a synthetic successful API.
  const resultsEndpoint = (url: URL) => url.pathname === '/api/resultados-examen/';
  await page.route(resultsEndpoint, route => route.abort('failed'));
  await login(page, 1);
  await expect(page.getByRole('alert')).toBeVisible();
  // The two students belonging to instructor A still load when results fail.
  const card = page.locator('div.glass-card').filter({ has: page.getByText('Alumnos', { exact: true }) }).first();
  await expect(card).toContainText('2');
  await page.unroute(resultsEndpoint);
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('@concurrent-regression connection notices refresh presence without reloading academic resources', async ({ page }) => {
  await page.addInitScript(() => {
    const observed = window as Window & { auditSockets: WebSocket[] };
    observed.auditSockets = [];
    const Socket = window.WebSocket;
    window.WebSocket = class extends Socket { constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); observed.auditSockets.push(this); } };
  });
  await login(page, 1);
  await expect.poll(() => page.evaluate(() => (window as Window & { auditSockets: WebSocket[] }).auditSockets.filter(s => s.readyState === WebSocket.OPEN && new URL(s.url).pathname === '/ws/conexiones/').length)).toBe(1);
  await page.waitForTimeout(2500);
  const calls: string[] = [];
  page.on('request', r => { const path = new URL(r.url()).pathname; if (path.startsWith('/api/') && !path.startsWith('/api/auth/')) calls.push(path); });
  const logs = await seed.admin.call('/api/registros-conexion/');
  expect(logs.status).toBe(200);
  expect((await seed.admin.call(`/api/registros-conexion/${logs.body[0].id}/`, 'PATCH', { ultima_actividad:new Date().toISOString() })).status).toBe(200);
  await page.waitForTimeout(2500);
  mkdirSync('../.run/concurrency-audit', { recursive:true });
  const phase = process.env.E2E_AUDIT_BEFORE === 'true' ? 'before' : 'after';
  writeFileSync(`../.run/concurrency-audit/dashboard-${phase}.json`, JSON.stringify({ calls, requests:calls.length },null,2));
  if (phase === 'after') expect(calls).toEqual(['/api/dashboard/counts/']);
});

test('@concurrent-regression eight isolated panels, refresh burst, offline recovery and 100 section changes', async ({ browser }) => {
  test.setTimeout(300_000);
  const contexts = await Promise.all(seed.fixtures.map(() => browser.newContext({ viewport: { width: 1440, height: 1000 } })));
  const pages = await Promise.all(contexts.map(c => c.newPage()));
  const errors: string[] = [], statuses: number[] = [];
  try {
    for (const page of pages) {
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', r => { if (new URL(r.url()).pathname.startsWith('/api/') && [403,409,429].includes(r.status()) || r.status() >= 500) statuses.push(r.status()); });
      await page.addInitScript(() => {
        const observed = window as Window & { auditSockets: WebSocket[] };
        observed.auditSockets = [];
        const Socket = window.WebSocket;
        window.WebSocket = class extends Socket { constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); observed.auditSockets.push(this); } };
      });
    }
    await Promise.all(pages.map((page,index) => login(page,index)));
    expect(new Set(await Promise.all(pages.map(binding))).size).toBe(8);
    let refreshes = 0;
    const page = pages[0];
    page.on('request', r => { if (new URL(r.url()).pathname === '/api/auth/refresh/') refreshes++; });
    await contexts[0].clearCookies({ name: 'uasspain_access' });
    const burst = await page.evaluate(async expectedProfile => {
      // Reuse the service loaded by the application, including its actual
      // refresh interceptor. Production has hashed assets, not /src modules.
      const asset=performance.getEntriesByType('resource').find(entry=>/\/assets\/authService-[^/]+\.js$/.test(entry.name))?.name;
      const module=await import(asset || '/src/services/authService.ts');
      const auth=Object.values(module).find((value:any)=>typeof value?.me==='function') as {me:()=>Promise<any>};
      if(!auth)throw new Error('Application authentication service not found');
      return Promise.all(Array.from({ length:20 },async()=>{
        const me=await auth.me();return (me?.profile?.id||me?.id)===expectedProfile;
      }));
    },seed.fixtures[0].id);
    expect(burst).toEqual(Array(20).fill(true)); expect(refreshes).toBe(1);
    const measure = async () => Promise.all(pages.map(p => p.evaluate(() => (window as Window & { auditSockets: WebSocket[] }).auditSockets.filter(s => s.readyState === WebSocket.OPEN).length)));
    const nav = (p: Page) => p.locator('aside:visible nav');
    const labels = await Promise.all(pages.map(p => nav(p).getByRole('button').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label') || ''))));
    // Warm every section first, then compare a bounded number of live sockets.
    for (let i = 0; i < 20; i++) await Promise.all(pages.map((p,index) => nav(p).getByRole('button', { name: labels[index][i % labels[index].length], exact:true }).click()));
    const warmSockets = await measure();
    for (let i = 20; i < 100; i++) await Promise.all(pages.map((p,index) => nav(p).getByRole('button', { name: labels[index][i % labels[index].length], exact:true }).click()));
    const finalSockets = await measure();
    expect(finalSockets.every((count,index) => count <= Math.max(1,warmSockets[index]))).toBe(true);
    await Promise.all(contexts.map(c => c.setOffline(true)));
    await new Promise(resolve => setTimeout(resolve, 5000));
    await Promise.all(contexts.map(c => c.setOffline(false)));
    for (const p of pages) {
      await nav(p).getByRole('button', { name:'Dashboard', exact:true }).click();
      await expect(p.locator('header h1')).toHaveText('Dashboard');
      const me = await p.request.get('/api/auth/me/', { headers: { 'X-UASSpain-Window-Id': await binding(p) } });
      expect(me.status()).toBe(200);
    }
    expect(errors).toEqual([]); expect(statuses).toEqual([]);
    mkdirSync('../.run/concurrency-audit', { recursive:true });
    writeFileSync('../.run/concurrency-audit/browser-concurrency.json', JSON.stringify({ panels:8, sectionChangesPerPanel:100, warmSockets, finalSockets, refreshBurst:20, refreshCalls:refreshes, offlineSeconds:5, errors, statuses },null,2));
  } finally { await Promise.all(contexts.map(c => c.close())); }
});

test('@concurrent-regression 50 copied windows claim independent locks and keep bindings on reload', async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext();
  const copied = crypto.randomUUID();
  await context.addInitScript(id => { if (!sessionStorage.getItem('fixture-initialized')) { sessionStorage.setItem('uasspain.window_session_id', id); sessionStorage.setItem('fixture-initialized','1'); } }, copied);
  try {
    const pages = await Promise.all(Array.from({ length:50 }, () => context.newPage()));
    const visit=async(page:Page,reload=false)=>{
      // A real application request runs window ownership before it reaches
      // the backend. This also exercises the built production application.
      const checked=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/me/');
      if(reload)await page.reload();else await page.goto('/');
      await checked;return binding(page);
    };
    const ids = await Promise.all(pages.map(p=>visit(p)));
    for (const count of [10,25,50]) expect(new Set(ids.slice(0,count)).size).toBe(count);
    expect(await Promise.all(pages.map(p=>visit(p,true)))).toEqual(ids);
    writeFileSync('../.run/concurrency-audit/windows.json', JSON.stringify({ windows:50, unique:50, reloadPreservesBinding:true }));
  } finally { await context.close(); }
});
