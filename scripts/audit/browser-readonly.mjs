/** Real Edge, anonymous ORIGINAL sessions; no business writes or fake responses. */
import { chromium, expect } from '../../frontend/node_modules/@playwright/test/index.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const postUpdate = process.argv.includes('--post-update');
const output = resolve(root, `docs/audits/evidence/2026-11-16-browser-readonly${postUpdate ? '-post-update' : ''}.json`);
mkdirSync(dirname(output), { recursive: true });
const report = { observed_at: new Date().toISOString(), origin: 'https://localhost', scope: 'Anonymous public pages and unauthenticated panel guards, real Edge, existing Docker instance', checks: [], blocked_write_requests: [], status: 'RUNNING', limits: ['No authenticated panel/business flow', 'No camera/audio claim', 'Initial local rendering metrics only; no INP or production percentiles', 'Does not replace the earlier role and functional evidence'] };
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: false, viewport: { width: 1280, height: 900 } });
  await context.route('**/*', async route => {
    const request = route.request();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      report.blocked_write_requests.push({ origin: new URL(request.url()).origin, path: new URL(request.url()).pathname, method: request.method() });
      return await route.abort('blockedbyclient');
    }
    return await route.continue();
  });
  await context.addInitScript(() => {
    const metrics = { cls: 0, lcp: null };
    Object.defineProperty(window, '__uasReadonlyMetrics', { value: metrics });
    try { new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) metrics.cls += entry.value; }).observe({ type: 'layout-shift', buffered: true }); } catch {}
    try { new PerformanceObserver(list => { for (const entry of list.getEntries()) metrics.lcp = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.name));
  for (const path of ['/', '/nosotros', '/tecnologia', '/blog', '/contacto', '/formacion', '/politica-privacidad', '/aviso-legal', '/politica-cookies']) {
    const previousErrors = pageErrors.length;
    const response = await page.goto(`https://localhost${path}`, { waitUntil: 'networkidle', timeout: 25000 });
    await expect(page.locator('body')).not.toBeEmpty();
    const observed = await page.evaluate(() => ({ secure_context: window.isSecureContext, text_length: document.body.innerText.trim().length, horizontal_overflow: document.documentElement.scrollWidth > innerWidth + 1, metrics: window.__uasReadonlyMetrics }));
    report.checks.push({ id: `PUBLIC:${path}`, status: response?.status() === 200 && observed.secure_context && observed.text_length > 40 && !observed.horizontal_overflow && pageErrors.length === previousErrors ? 'PASS' : 'FAIL', http: response?.status(), ...observed, new_js_errors: pageErrors.slice(previousErrors) });
  }
  for (const role of ['admin', 'instructor', 'alumno']) {
    const before = report.blocked_write_requests.length;
    await page.goto(`https://localhost/${role}`, { waitUntil: 'networkidle', timeout: 25000 });
    await expect(page).toHaveURL(url => url.pathname === '/', { timeout: 15000 });
    report.checks.push({ id: `ANONYMOUS_PANEL:${role}`, status: report.blocked_write_requests.length === before ? 'PASS' : 'BLOCKED', redirected_home: true, scope: 'Anonymous route guard only; not role authorization or authenticated panel coverage' });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('https://localhost/', { waitUntil: 'networkidle', timeout: 25000 });
  const mobile = await page.evaluate(() => ({ width: innerWidth, scroll_width: document.documentElement.scrollWidth, secure_context: isSecureContext }));
  report.checks.push({ id: 'PUBLIC_MOBILE_OVERFLOW', status: mobile.secure_context && mobile.scroll_width <= mobile.width + 1 ? 'PASS' : 'FAIL', ...mobile });
  await page.screenshot({ path: resolve(root, `docs/audits/evidence/2026-11-16-public-mobile${postUpdate ? '-post-update' : ''}.png`), fullPage: false });
  report.status = report.checks.every(x => x.status === 'PASS') && report.blocked_write_requests.length === 0 ? 'PASS' : 'BLOCKED';
  await context.close();
} catch (error) {
  report.status = 'BLOCKED';
  report.reason = `${error.name}: ${String(error.message).split('\n')[0]}`;
} finally {
  await browser?.close();
  report.completed_at = new Date().toISOString();
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ report: output.slice(root.length + 1), status: report.status, checks: report.checks.map(({ id, status }) => ({ id, status })), reason: report.reason || null, blocked_writes: report.blocked_write_requests.length }));
if (report.status !== 'PASS') process.exitCode = 1;
