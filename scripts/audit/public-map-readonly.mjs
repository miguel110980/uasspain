/** Follow-up to the blocked read-only Maps RPC, not a rerun of passed pages. */
import { chromium, expect } from '../../frontend/node_modules/@playwright/test/index.mjs';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const rpc = 'https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/GetViewportInfo';
const output = resolve(root, 'docs/audits/evidence/2026-11-16-public-map.json');
const report = { started_at: new Date().toISOString(), scope: 'Real Edge on ORIGINAL /contacto; one exact Google Maps read RPC allowed; all business POST/PUT/PATCH/DELETE remain blocked', blocked_requests: [], rpc_responses: [], status: 'RUNNING' };
if (existsSync(output)) { const prior = JSON.parse(readFileSync(output, 'utf8')); report.previous_attempt = { status: prior.status, reason: prior.reason, completed_at: prior.completed_at, rpc_responses: prior.rpc_responses }; }
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: false, viewport: { width: 1366, height: 900 } });
  await context.route('**/*', async route => {
    const r = route.request(), u = new URL(r.url());
    if (['GET', 'HEAD', 'OPTIONS'].includes(r.method()) || (r.method() === 'POST' && u.origin + u.pathname === rpc)) return route.continue();
    report.blocked_requests.push({ origin: u.origin, path: u.pathname, method: r.method() }); return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.on('response', r => { const u = new URL(r.url()); if (u.origin + u.pathname === rpc) report.rpc_responses.push({ http: r.status(), method: r.request().method() }); });
  const response = await page.goto('https://localhost/contacto', { waitUntil: 'networkidle' });
  const frameElement = page.getByTitle('UASSPAIN Ubicación', { exact: true });
  await frameElement.scrollIntoViewIfNeeded(); await expect(frameElement).toBeVisible();
  const frame = await (await frameElement.elementHandle()).contentFrame();
  await frame.waitForFunction(() => document.body.innerText.trim().length > 30, undefined, { timeout: 15000 });
  report.observed = await frame.evaluate(() => ({ title: document.title, body_text_length: document.body.innerText.trim().length, canvases: [...document.querySelectorAll('canvas')].map(c => ({ width: c.width, height: c.height })), images_loaded: [...document.images].filter(i => i.complete && i.naturalWidth > 0).length, raster_map_tiles_loaded: [...document.images].filter(i => /[\/]maps[\/]vt[?]|[\/]vt[?]/.test(i.src) && i.complete && i.naturalWidth > 100).length, role_regions: [...document.querySelectorAll('[role="region"]')].map(x => x.getAttribute('aria-label')).filter(Boolean) }));
  await frameElement.screenshot({ path: resolve(root, 'docs/audits/evidence/2026-11-16-public-map.png') });
  report.local_http = response.status(); report.tls_validation_enabled = true;
  report.status = response.status() === 200 && (report.observed.canvases.some(c => c.width > 200 && c.height > 100) || report.observed.raster_map_tiles_loaded > 0) && report.rpc_responses.some(r => r.http === 200 && r.method === 'POST') && report.blocked_requests.length === 0 ? 'PASS' : 'BLOCKED';
  await context.close();
} catch (error) { report.status = 'BLOCKED'; report.reason = `${error.name}: ${String(error.message).split('\n')[0]}`.slice(0, 200); }
finally { await browser?.close(); report.completed_at = new Date().toISOString(); writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ status: report.status, rpc_responses: report.rpc_responses, blocked: report.blocked_requests.length, report: 'docs/audits/evidence/2026-11-16-public-map.json' }));
if (report.status !== 'PASS') process.exitCode = 1;
