// Production regression: real HTTPS routes/assets; fault injection is confined
// to two browser contexts and never changes the server or application data.
import { chromium } from '../../frontend/node_modules/playwright/index.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import https from 'node:https';
import http from 'node:http';
import assert from 'node:assert/strict';

const origin = process.env.FRONTEND_TEST_ORIGIN || 'https://localhost';
const ca = await readFile(process.env.FRONTEND_TEST_CA || '.secrets/tls/ca.crt');
function request(url) {
  return new Promise((resolve, reject) => {
    const transport = new URL(url).protocol === 'https:' ? https : http;
    const req = transport.get(url, { ca, timeout: 10000 }, response => {
      const chunks = [];
      response.on('data', c => chunks.push(c));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('request timeout')));
  });
}
const report = { routes: [], assets: [], recovery: [], history: {} };
const source = await readFile('frontend/src/App.tsx', 'utf8');
const routes = [...new Set([
  ...[...source.matchAll(/<Route path="([^"]+)" element=\{<(\w+)\s*\/>\}/g)].map(m => m[1]).filter(r => !r.includes('*')),
  '/admin', '/instructor', '/alumno',
])];
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const errors = []; const assets = new Set();
  const devtools = await context.newCDPSession(page);
  await devtools.send('Network.enable'); await devtools.send('Runtime.enable');
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (/\/assets\/.*\.(js|css)$/.test(r.url())) assets.add(r.url()); });
  for (const route of routes) {
    const response = await request(origin + route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers['cache-control'], /no-store/, route);
    await page.goto(origin + route);
    await page.waitForFunction(() => Object.keys(document.getElementById('root')).some(k => k.startsWith('__reactContainer')));
    await page.locator('h1').first().waitFor();
    await page.reload();
    await page.waitForFunction(() => Object.keys(document.getElementById('root')).some(k => k.startsWith('__reactContainer')));
    assert.equal(await page.getByText('No se pudo cargar la aplicación', { exact: true }).count(), 0);
    report.routes.push({ route, direct: response.status, refreshed: true });
  }
  await page.goto(origin + '/');
  await page.getByRole('link', { name: 'Tecnología', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Stack Tecnológico', level: 1, exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/tecnologia');
  await page.goBack();
  await page.waitForURL(origin + '/');
  await page.locator('main h1').first().waitFor();
  await page.goForward();
  await page.waitForURL(origin + '/tecnologia');
  await page.getByRole('heading', { name: 'Stack Tecnológico', level: 1, exact: true }).waitFor();
  report.history = { back: '/', forward: '/tecnologia', passed: true };
  if (process.env.FRONTEND_TEST_MANIFEST) {
    const manifest = JSON.parse(await readFile(process.env.FRONTEND_TEST_MANIFEST, 'utf8'));
    for (const entry of Object.values(manifest)) {
      for (const asset of [entry.file, ...(entry.css || [])]) {
        if (/\.(js|css)$/.test(asset)) assets.add(new URL('/' + asset, origin).href);
      }
    }
  }
  for (const url of assets) {
    assert.equal(new URL(url).origin, origin);
    const response = await request(url);
    assert.equal(response.status, 200, url);
    assert.match(response.headers['content-type'], url.endsWith('.js') ? /javascript/ : /text\/css/);
    assert.match(response.headers['cache-control'], /immutable/);
    assert.doesNotMatch(response.body.slice(0, 100), /<!doctype html/i);
    report.assets.push({ url, status: response.status, type: response.headers['content-type'] });
  }
  const missing = await request(origin + '/assets/does-not-exist.js');
  assert.equal(missing.status, 404); assert.match(missing.headers['content-type'], /text\/plain/);
  assert.match(missing.headers['cache-control'], /no-store/); assert.doesNotMatch(missing.body, /<html/i);
  const unknown = await request(origin + '/route-does-not-exist'); assert.equal(unknown.status, 404);
  const alias = await request(origin + '/tecnolog%C3%ADa'); assert.equal(alias.status, 308);
  assert.equal(alias.headers.location, '/tecnologia');
  await page.goto(origin + '/tecnolog%C3%ADa');
  await page.getByRole('heading', { name: 'Stack Tecnológico', level: 1, exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/tecnologia');
  const redirect = await request(origin.replace('https:', 'http:') + '/tecnologia');
  assert.equal(redirect.status, 301); assert.equal(redirect.headers.location, origin + '/tecnologia');
  assert.deepEqual(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(r => r.scope)), []);
  assert.deepEqual(errors, []);
  await context.close();

  // Newer release + missing lazy chunk: exactly one automatic reload to the
  // requested page. Persistently broken chunk: no reload loop across navigation.
  for (const chunk of ['Tecnologia', 'Home']) for (const persistent of [false, true]) {
    const recoveryContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const recoveryPage = await recoveryContext.newPage();
    const failures = []; let documents = 0; let blocked = 0;
    recoveryPage.on('request', r => { if (r.isNavigationRequest() && r.frame() === recoveryPage.mainFrame()) documents++; });
    await recoveryPage.route('**/version.json', r => r.fulfill({ json: { buildId: '12345678-1234-1234-1234-123456789abc' } }));
    await recoveryPage.route(`**/assets/${chunk}-*.js`, async r => {
      if (persistent || documents < 2) { blocked++; failures.push(r.request().url()); await r.fulfill({ status: 404, contentType: 'text/plain', body: 'Asset not found' }); }
      else await r.continue();
    });
    await recoveryPage.goto(origin + '/');
    if (chunk === 'Tecnologia') await recoveryPage.getByRole('link', { name: 'Tecnología', exact: true }).first().click();
    await recoveryPage.waitForFunction(() => performance.getEntriesByType('navigation')[0]?.type === 'reload');
    if (persistent) {
      await recoveryPage.getByText('No se pudo cargar la aplicación', { exact: true }).waitFor();
      await recoveryPage.waitForTimeout(2500);
      assert.equal(documents, 2, 'one initial document plus one recovery, without loops');
    } else {
      await recoveryPage.waitForFunction(() => Object.keys(document.getElementById('root')).some(k => k.startsWith('__reactContainer')));
      if (chunk === 'Tecnologia') await recoveryPage.getByRole('heading', { name: 'Stack Tecnológico', level: 1, exact: true }).waitFor();
      else await recoveryPage.locator('h1').first().waitFor();
      assert.equal(await recoveryPage.getByText('No se pudo cargar la aplicación', { exact: true }).count(), 0);
      assert.equal(documents, 2);
      assert.equal(new URL(recoveryPage.url()).pathname, chunk === 'Tecnologia' ? '/tecnologia' : '/');
    }
    report.recovery.push({ chunk, persistent, documents, blocked, failures });
    await recoveryContext.close();
  }
  console.log(`PASS: ${report.routes.length} direct/refreshed routes, ${report.assets.length} HTTPS assets, canonical redirect, real 404s, automatic recovery and loop prevention.`);
} finally {
  await browser.close();
  if (process.env.FRONTEND_TEST_REPORT) await writeFile(process.env.FRONTEND_TEST_REPORT, JSON.stringify(report, null, 2));
}
