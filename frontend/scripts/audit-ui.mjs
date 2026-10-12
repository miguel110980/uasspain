import { chromium, firefox, webkit } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { X509Certificate, createHash } from 'node:crypto';
import https from 'node:https';
import http from 'node:http';
import fixture from './ui-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = process.env.UI_AUDIT_ORIGIN || 'https://localhost';
const folder = path.resolve(process.env.UI_AUDIT_REPORT || path.join(root, '..', '.run', 'frontend-ui-audit'));
const engine = process.env.UI_AUDIT_BROWSER || 'chromium';
const widths = (process.env.UI_AUDIT_WIDTHS || '320,375,390,768,1024,1366,1440,1920,2560,3840').split(',').map(Number);
const roles = (process.env.UI_AUDIT_ROLES || 'public,admin,instructor,alumno').split(',');
const live = process.env.UI_AUDIT_LIVE === 'true';
const seed = live ? await (await import('../../scripts/e2e/concurrent-fixtures.mjs')).concurrentFixtures(8) : null;
const report = { origin, engine, widths, liveBackend: live, screens: [], errors: [], warnings: [], failures: [], writesIntercepted: 0 };
await mkdir(folder, { recursive: true });
const app = await readFile(path.join(root, 'src', 'App.tsx'), 'utf8');
const ca = await readFile(path.join(root, '..', '.secrets/tls/ca.crt'));
// Public service routes are managed in PostgreSQL, rather than declared one
// by one in App. Read only their published metadata for complete route coverage.
const services = await new Promise((resolve, reject) => {
  const transport = new URL(origin).protocol === 'https:' ? https : http;
  const request = transport.get(origin + '/api/services', { ca, timeout: 15000 }, response => {
    let body = ''; response.on('data', chunk => { body += chunk; });
    response.on('end', () => { try { assert.equal(response.statusCode, 200); resolve(JSON.parse(body)); } catch (error) { reject(error); } });
  });
  request.on('error', reject); request.on('timeout', () => request.destroy(new Error('Public catalog timeout')));
});
const publicRoutes = [...app.matchAll(/<Route path="([^"]+)"/g)].map(m => m[1])
  .filter(route => !route.includes('*') && !route.includes(':') && !['/admin', '/instructor', '/alumno', '/elegir-panel', '/restablecer-contrasena'].includes(route));
const courses = live ? (await seed.admin.call('/api/courses')).body : fixture.courses;
publicRoutes.push(...services.map(service => '/servicios/' + encodeURIComponent(service.slug)), ...courses.map(course => '/formacion/' + course.slug.split('/').map(encodeURIComponent).join('/')), '/ruta-inexistente-' + 'x'.repeat(120));
const cert = new X509Certificate(await readFile(path.join(root, '..', '.secrets/tls/edge.crt')));
const pin = createHash('sha256').update(cert.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
const browser = await ({ chromium, firefox, webkit })[engine].launch(engine === 'chromium' ? { args: ['--ignore-certificate-errors-spki-list=' + pin] } : {});

async function setup(role) {
  const context = await browser.newContext({ ignoreHTTPSErrors: false, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push({ role, message: error.message }));
  page.on('console', message => { if (message.type() === 'warning') report.warnings.push({ role, message: message.text() }); });
  if (live) return { context, page };
  await page.routeWebSocket('**/ws/**', ws => ws.onMessage(() => {}));
  await page.route('https://www.google.com/maps**', route => route.fulfill({ contentType: 'text/html', body: '<p>Mapa de prueba</p>' }));
  // A pathname predicate also works on Vite: never intercept /src/api modules.
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request(), p = new URL(request.url()).pathname;
    const me = fixture.profiles.find(profile => profile.role === role);
    if (p === '/api/auth/me/') {
      const optional = new URL(request.url()).searchParams.get('optional') === 'true';
      return route.fulfill({ status: me || optional ? 200 : 401, json: me ? { ...me, session_role: role, full_name: `${me.nombre} ${me.apellidos}`, profile: me } : optional ? null : { detail: 'Sin sesión' } });
    }
    if (request.method() !== 'GET') {
      report.writesIntercepted++;
      return route.fulfill({ status: p.includes('refresh') ? 401 : 200, json: { detail: 'Respuesta sintética' } });
    }
    let data = [];
    if (p === '/api/public/content/versions/') data = { services: '1', posts: '1', courses: '1' };
    else if (p === '/api/services' || p === '/api/admin/services') data = services;
    else if (p.startsWith('/api/services/')) {
      data = services.find(service => service.slug === decodeURIComponent(p.slice('/api/services/'.length)));
      if (!data) return route.fulfill({ status: 404, json: { detail: 'Servicio no encontrado' } });
    }
    else if (p === '/api/admin/content-images') data = [];
    else if (p === '/api/courses' || p === '/api/admin/courses') data = fixture.courses;
    else if (p.startsWith('/api/courses/')) {
      data = fixture.courses.find(course => course.slug === decodeURIComponent(p.slice('/api/courses/'.length)));
      if (!data) return route.fulfill({ status: 404, json: { detail: 'Curso no encontrado' } });
    } else if (p === '/api/system/status/') data = fixture.status;
    else if (p === '/api/profiles/') data = fixture.profiles;
    else if (p === '/api/profiles/instructores/') data = fixture.profiles.filter(profile => profile.role === 'instructor' && profile.status === 'activo');
    else if (p.includes('/contacts/')) data = fixture.profiles.filter(profile => profile.id !== me?.id && ['admin', 'instructor'].includes(profile.role));
    else if (p.startsWith('/api/profiles/')) data = me;
    else if (p === '/api/system/auth-policy/') data = fixture.status.two_factor;
    else if (p.startsWith('/api/system/')) data = { enabled: false, host: '', port: 587, origins: [], required_roles: [], client_id: '', password_configured: false };
    else if (p === '/api/backups/config/') data = { key: 'backups', value: { frequency: 'manual', hour: '03:00', day: '*', job_type: 'automatic', retention_days: 30, encrypt: true } };
    else if (p === '/api/backups/status/') data = { system_status: 'not_configured', timezone: 'Europe/Madrid', history_total: 0, storage_used_bytes: 0, scheduler_enabled: true, restore_enabled: true, encryption_enabled: true };
    else if (p === '/api/vpn/status/') data = { state: 'disconnected', configured: false, peers: [], warnings: [] };
    else if (p === '/api/public/oauth/google/') data = { client_id: '' };
    return route.fulfill({ json: data });
  });
  return { context, page };
}

async function inspect(page, role, section) {
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { localStorage.setItem('theme', theme); document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add(theme); }, theme);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(width === Math.min(...widths) || width === Math.max(...widths.filter(w => w <= 1440)) ? 1200 : 70);
      const bounds = await page.evaluate(() => {
        const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
        const controls = [...document.querySelectorAll('input:not([type=hidden]),select,textarea,button')].filter(visible)
          .filter(element => !element.closest('[aria-hidden=true],.sr-only') && !element.matches('[aria-hidden=true]'));
        const clipped = controls.filter(element => {
          const rect = element.getBoundingClientRect();
          return (rect.right > innerWidth + 2 || rect.left < -2) && !element.closest('.overflow-x-auto,.overflow-auto');
        }).map(element => ({ html: element.outerHTML.slice(0, 350) }));
        return { overflow: document.documentElement.scrollWidth > innerWidth + 1, clipped, heading: document.querySelector('h1')?.textContent };
      });
      const screen = { role, section, theme, width, ...bounds, violations: [] };
      // Both themes at the smallest and desktop widths; all widths get layout checks.
      if (width === Math.min(...widths) || width === Math.max(...widths.filter(w => w <= 1440))) {
        // Paint each deferred Home section in the current theme before inspecting
        // its contrast. Offscreen content-visibility can retain old computed
        // colors until the section enters the viewport; scrolling exercises the
        // same rendering path as the user and still audits every node.
        if (await page.locator('.home-page').count()) {
          const position = await page.evaluate(() => scrollY);
          for (const element of await page.locator('.home-page main section').all()) {
            await element.scrollIntoViewIfNeeded();
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          }
          await page.evaluate(y => scrollTo({ top: y, behavior: 'instant' }), position);
        }
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        screen.violations = results.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, html: n.html, summary: n.failureSummary })) }));
        const filename = `${role}-${section}-${theme}-${width}`.replace(/[^\w-]/g, '_') + '.png';
        screen.screenshot = path.join(folder, filename);
        await page.screenshot({ path: screen.screenshot, fullPage: false });
      }
      report.screens.push(screen);
      if (bounds.overflow || bounds.clipped.length || screen.violations.length) report.failures.push(screen);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(150);
}

try {
  for (const role of roles) {
    const { context, page } = await setup(role);
    if (role === 'public') {
      for (const route of publicRoutes) {
        await page.goto(origin + route);
        await page.locator('h1').first().waitFor();
        await page.waitForTimeout(300);
        await inspect(page, role, route);
      }
      await page.goto(origin + '/?auth=login');
      await page.getByRole('dialog', { name: 'Cuenta UASSPAIN' }).waitFor();
      await inspect(page, role, 'login');
      await page.getByRole('button', { name: 'Registrarse', exact: true }).click();
      await page.getByRole('dialog').getByText('Nombre', { exact: false }).first().waitFor();
      await inspect(page, role, 'registro');
      await page.getByRole('button', { name: /Volver al acceso/ }).click();
      await page.getByRole('button', { name: /contraseña\?/ }).click();
      await page.getByRole('heading', { name: 'Recuperar contraseña' }).waitFor();
      await inspect(page, role, 'recuperacion');
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('dialog').count(), 0, 'Escape cierra el diálogo de recuperación');
    } else {
      if (live) {
        const account = seed.fixtures[{ admin:0, instructor:1, alumno:3 }[role]];
        await page.goto(origin + '/?auth=login');
        await page.getByLabel('Correo electrónico *', { exact:true }).fill(account.email);
        await page.getByLabel('Contraseña *', { exact:true }).fill(account.password);
        await page.getByRole('button', { name:'Iniciar sesión', exact:true }).click();
        await page.waitForURL(new RegExp('/' + role + '$'));
      }
      await page.goto(origin + '/' + role);
      await page.locator('header h1').waitFor();
      const sections = await page.locator('aside:visible nav button').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
      for (const section of sections) {
        await page.locator('aside:visible nav').getByRole('button', { name: section, exact: true }).click();
        await page.waitForTimeout(350);
        await inspect(page, role, section);
      }
      // Mobile dialog traps focus, closes on Escape and restores the trigger.
      await page.setViewportSize({ width: 320, height: 568 });
      const trigger = page.locator('header').getByRole('button', { name: 'Abrir menú', exact: true });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: 'Menú del panel' });
      await dialog.waitFor();
      await page.keyboard.press('Shift+Tab');
      assert.ok(await dialog.evaluate(node => node.contains(document.activeElement)));
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.ok(await trigger.evaluate(node => node === document.activeElement));
      await trigger.click();
      await dialog.waitFor();
      await page.setViewportSize({ width: 1440, height: 900 });
      await dialog.waitFor({ state: 'hidden' });
      // Nonmodal popovers support arrows and restore focus with Escape.
      const account = page.getByRole('button', { name: 'Menú de cuenta' });
      await account.click();
      await page.getByRole('dialog', { name: 'Menú de cuenta' }).waitFor();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Escape');
      assert.ok(await account.evaluate(node => node === document.activeElement));
    }
    await context.close();
    await writeFile(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`${role}: ${report.screens.filter(screen => screen.role === role).length} estados verificados`);
  }
} finally {
  await browser.close();
  await seed?.cleanup();
  await writeFile(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ screens: report.screens.length, failures: report.failures.length, errors: report.errors, warnings: report.warnings, writesIntercepted: report.writesIntercepted }, null, 2));
assert.equal(report.errors.length, 0, 'Sin excepciones JavaScript');
assert.equal(report.warnings.length, 0, 'Sin warnings del frontend');
assert.equal(report.failures.length, 0, `Ver fallos de layout o accesibilidad en ${folder}`);
