/** Real UI flows on synthetic accounts in the existing, version-matched lab. */
import { chromium, expect } from '../../frontend/node_modules/@playwright/test/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const origin = 'http://127.0.0.1:18010';
const output = resolve(root, 'docs/audits/evidence/2026-11-16-lab-browser.json');
function unprotect(path, entropy) {
  try { return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Security;$b=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes('${path.replaceAll("'", "''")}'),[Text.Encoding]::UTF8.GetBytes('${entropy}'),[Security.Cryptography.DataProtectionScope]::CurrentUser);try{[Console]::Write([Text.Encoding]::UTF8.GetString($b))}finally{[Array]::Clear($b,0,$b.Length)}`], { encoding: 'utf8', windowsHide: true, stdio: ['ignore','pipe','pipe'] })); }
  catch { throw Error('Protected lab fixture unavailable'); }
}
const fixture = unprotect(resolve(root, '.run/audit-20261116/lab-fixtures.dpapi'), 'UASSpain|audit-20261116|lab-fixtures|v1');
const env = unprotect(resolve(root, '.run/closure-20261109-630870e0/api-lab.dpapi'), 'UASSpain|closure20261109|630870e0');
if (fixture.project !== 'uasspain-mail-audit-closure-630870e0') throw Error('Unexpected lab identity');
const matchingImages = JSON.parse(readFileSync(resolve(root, 'docs/audits/evidence/2026-11-16-existing-lab.json'), 'utf8'));
const prior = process.argv.includes('--resume') ? JSON.parse(readFileSync(output, 'utf8')) : null;
if (prior && JSON.stringify(prior.images) !== JSON.stringify(matchingImages.images)) throw Error('Cannot retain results across a changed image set');
const report = prior || { started_at: new Date().toISOString(), origin, scope: 'Real Edge; existing synthetic lab with exact updated original backend/frontend images. Navigation is not every internal action; no WAN/media/TLS certification', images: matchingImages.images, checks: [], navigation: [], status: 'RUNNING' };
if (prior) { report.previous_attempts = [...(prior.previous_attempts || []), { completed_at: prior.completed_at, status: prior.status, reason: prior.reason, step: prior.current_step }]; delete report.reason; report.status = 'RUNNING'; }
const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
const pass = (id, observed = {}) => { report.checks = report.checks.filter(x => x.id !== id).concat({ id, status: 'PASS', observed }); save(); };
const regex = value => new RegExp('^' + value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
let browser, currentPage;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const accounts = [{ role: 'admin', email: 'e2e-admin@test.local', password: env.CLOSURE_ADMIN_PASSWORD }, fixture.actors.find(x => x.role === 'instructor'), fixture.actors.find(x => x.role === 'alumno' && x.index === 0)];
  for (const account of accounts) {
    if (report.checks.some(x => x.id === `BROWSER_LOGOUT:${account.role}` && x.status === 'PASS')) continue;
    report.current_step = `login:${account.role}`; save();
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, ignoreHTTPSErrors: false, acceptDownloads: true });
    const page = await context.newPage(); currentPage = page; const errors = [];
    page.on('pageerror', error => errors.push(error.name));
    await page.goto(origin + '/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /^acceso$/i }).click();
    await page.locator('#login-email').fill(account.email); await page.locator('#login-password').fill(account.password);
    await page.getByRole('button', { name: /^iniciar sesión$/i }).click();
    await page.waitForURL(url => url.pathname === '/' + account.role || url.pathname === '/elegir-panel', { timeout: 20000 });
    if (new URL(page.url()).pathname === '/elegir-panel') {
      await page.getByRole('button', { name: account.role === 'admin' ? /^Administrador/ : /^Instructor/ }).click();
      await page.waitForURL(url => url.pathname === '/' + account.role);
    }
    await page.locator('aside:visible').first().waitFor();
    pass(`BROWSER_LOGIN:${account.role}`, { actual_panel: account.role });
    const className = { admin: 'AdminPanel', instructor: 'InstructorPanel', alumno: 'AlumnoPanel' }[account.role];
    const source = readFileSync(resolve(root, `frontend/src/pages/${className}.tsx`), 'utf8');
    const menu = source.slice(source.indexOf('const NAV_GROUPS'), source.indexOf('];', source.indexOf('const NAV_GROUPS')));
    const items = [...menu.matchAll(/id: '([^']+)', label: '([^']+)'/g)].map(m => ({ id: m[1], label: m[2] }));
    for (const item of items) {
      if (report.navigation.some(x => x.role === account.role && x.section === item.id && x.status === 'PASS')) continue;
      report.current_step = `navigation:${account.role}/${item.id}`; save();
      const initialErrors = errors.length;
      await page.locator('aside:visible').first().getByRole('button', { name: regex(item.label) }).click();
      await expect(page.locator('header h1')).toHaveText(item.label);
      await page.waitForTimeout(250);
      const visible = await page.locator('main:visible').first().innerText();
      if (!visible.trim() || errors.length !== initialErrors) throw Error(`Navigation rendering failed: ${account.role}/${item.id}`);
      report.navigation.push({ role: account.role, section: item.id, status: 'PASS', visible_text: true, new_js_errors: 0, scope: 'Menu/title/nonempty visible pane only' }); save();
    }
    pass(`NAVIGATION:${account.role}`, { sections: items.length });
    if (account.role === 'alumno') {
      report.current_step = 'student_materials'; save();
      await page.locator('aside:visible').first().getByRole('button', { name: /^material$/i }).click();
      await expect(page.getByRole('heading', { name: 'Material de Estudio', exact: true })).toBeVisible();
      for (const category of ['A1/A3', 'A2', 'STS', 'Radiofonista']) await expect(page.getByRole('heading', { name: regex(category) })).toBeVisible();
      pass('MATERIAL_FOUR_CATEGORIES_VISIBLE');
      for (const resource of fixture.material_resources.filter(x => x.label.startsWith('desbloqueado'))) {
        const title = `Materiales ${resource.category} ${resource.label} Synthetic`;
        const card = page.getByText(title, { exact: true }).locator('..').locator('..');
        const downloadEvent = page.waitForEvent('download');
        await card.getByRole('button', { name: /^descargar$/i }).click();
        const download = await downloadEvent;
        const path = await download.path(); if (!path || await download.failure()) throw Error('Browser download failed');
        const bytes = readFileSync(path);
        if (bytes.length !== resource.bytes || createHash('sha256').update(bytes).digest('hex') !== resource.sha256) throw Error('Downloaded synthetic document differs');
        pass(`BROWSER_DOWNLOAD:${resource.category}`, { bytes: bytes.length, exact_sha256: true });
      }
      for (const resource of fixture.material_resources.filter(x => x.label.startsWith('bloqueado'))) {
        const card = page.getByText(`Materiales ${resource.category} ${resource.label} Synthetic`, { exact: true }).locator('..').locator('..');
        await expect(card.getByRole('button', { name: /^bloqueado$/i })).toBeDisabled();
        await expect(card.getByRole('button', { name: /^marcar$/i })).toBeDisabled();
      }
      pass('BROWSER_LOCKED_CONTROLS_DISABLED');
      const first = fixture.material_resources.find(x => x.label === 'desbloqueado-0');
      const firstTitle = `Materiales ${first.category} ${first.label} Synthetic`;
      await page.getByText(firstTitle, { exact: true }).locator('..').locator('..').getByRole('button', { name: /^marcar$/i }).click();
      await expect(page.getByText(firstTitle, { exact: true }).locator('..').locator('..').getByRole('button', { name: /^completado$/i })).toBeVisible();
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('aside:visible').first().getByRole('button', { name: /^material$/i }).click();
      await expect(page.getByText(firstTitle, { exact: true }).locator('..').locator('..').getByRole('button', { name: /^completado$/i })).toBeVisible();
      pass('BROWSER_COMPLETION_PERSISTS_RELOAD');
      await page.screenshot({ path: resolve(root, 'docs/audits/evidence/2026-11-16-lab-materials.png'), fullPage: false });
      await page.goto(origin + '/admin', { waitUntil: 'networkidle' });
      await expect(page.getByRole('heading', { name: /^acceso denegado$/i })).toBeVisible();
      pass('STUDENT_ADMIN_ROUTE_DENIED');
      await page.goto(origin + '/alumno', { waitUntil: 'networkidle' });
    }
    await page.getByRole('button', { name: 'Menú de cuenta', exact: true }).click();
    report.current_step = `logout:${account.role}`; save();
    const logoutResponse = page.waitForResponse(r => r.url().endsWith('/api/auth/logout/') && r.request().method() === 'POST');
    await page.getByRole('dialog', { name: 'Menú de cuenta', exact: true }).getByRole('button', { name: /cerrar sesión/i }).click();
    const loggedOut = await logoutResponse;
    await page.waitForURL(url => url.pathname === '/');
    if (![200,204].includes(loggedOut.status())) throw Error('Logout request failed');
    pass(`BROWSER_LOGOUT:${account.role}`, { http: loggedOut.status() });
    await context.close();
  }
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  let reason = `${error.name}: ${String(error.message).split('\n')[0]}`;
  for (const actor of fixture.actors) if (actor.password) reason = reason.replaceAll(actor.password, '[REDACTED]');
  reason = reason.replaceAll(env.CLOSURE_ADMIN_PASSWORD, '[REDACTED]');
  report.reason = reason.slice(0, 240); process.exitCode = 1;
  if (currentPage) {
    report.failure_path = new URL(currentPage.url()).pathname;
    let text = (await currentPage.locator('body').innerText().catch(() => '')).slice(-1200);
    for (const actor of fixture.actors) if (actor.password) text = text.replaceAll(actor.password, '[REDACTED]');
    report.failure_visible_text = text.replaceAll(env.CLOSURE_ADMIN_PASSWORD, '[REDACTED]');
  }
} finally { await browser?.close(); report.completed_at = new Date().toISOString(); save(); }
console.log(JSON.stringify({ status: report.status, checks: report.checks.length, navigation: report.navigation.length, reason: report.reason || null, report: 'docs/audits/evidence/2026-11-16-lab-browser.json' }));
