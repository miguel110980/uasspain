import { chromium } from '../../frontend/node_modules/playwright/index.mjs';
import AxeBuilder from '../../frontend/node_modules/@axe-core/playwright/dist/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const origin = process.env.HERO_ORIGIN || 'https://localhost';
const sizes = [
  [320, 568], [360, 640], [375, 667], [390, 844], [412, 915], [430, 932],
  [600, 960], [768, 1024], [820, 1180], [912, 1368], [1024, 768], [1024, 1366],
  [1180, 820], [1280, 720], [1280, 800], [1366, 768], [1395, 1127], [1440, 900],
  [1536, 864], [1600, 900], [1920, 1080], [2560, 1440], [844, 390], [667, 375],
  [568, 320], [1024, 820], [1440, 960], [2560, 1080],
];
const report = { origin, states: [], accessibility: [], errors: [], warnings: [], contact: false, services: false };
const browser = await chromium.launch();
try {
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, reducedMotion: 'reduce', viewport: { width: sizes[0][0], height: sizes[0][1] } });
    await context.addInitScript(value => localStorage.setItem('theme', value), theme);
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); if (m.type() === 'warning') report.warnings.push(m.text()); });
    await page.goto(origin + '/');
    await page.waitForFunction(() => document.documentElement.dataset.hydrated === 'true');
    await page.evaluate(() => document.fonts.ready);
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height }); await page.evaluate(() => scrollTo(0, 0));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(100);
      await page.waitForFunction(() => {
        const title = document.querySelector('.hero-title');
        return Math.abs(title.getBoundingClientRect().height - parseFloat(getComputedStyle(title).lineHeight) * 2) < 0.1;
      });
      const state = await page.evaluate(() => {
        const box = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        const image = document.querySelector('.hero-image'), r = image.getBoundingClientRect();
        const scale = Math.min(r.width / image.naturalWidth, r.height / image.naturalHeight);
        const left = r.x + (r.width - image.naturalWidth * scale) / 2, top = r.y + (r.height - image.naturalHeight * scale) / 2;
        // Include the propellers in the aircraft bounds on the existing 1672x941 photo.
        const drone = { x: left + 520 / 1672 * image.naturalWidth * scale, right: left + 1170 / 1672 * image.naturalWidth * scale,
          y: top + 145 / 941 * image.naturalHeight * scale, bottom: top + 325 / 941 * image.naturalHeight * scale };
        const ring = document.querySelector('.hero-radar-ring'), matrix = ring.getScreenCTM();
        const cx = ring.cx.baseVal.value, cy = ring.cy.baseVal.value;
        const center = new DOMPoint(cx, cy).matrixTransform(matrix), edge = new DOMPoint(cx + ring.r.baseVal.value, cy).matrixTransform(matrix);
        const title = document.querySelector('.hero-title'), copyStyle = getComputedStyle(document.querySelector('.hero-copy'));
        return { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          hero: box(document.querySelector('#inicio')), nav: box(document.querySelector('nav[aria-label="Navegación principal"]')),
          imageFit: getComputedStyle(image).objectFit, drone, title: box(title), font: getComputedStyle(title).fontSize,
          lines: [...title.querySelectorAll('.hero-title-line')].map(el => ({ text: el.textContent.trim(), ...box(el) })),
          buttons: [...document.querySelectorAll('.hero-copy a')].map(el => ({ href: el.getAttribute('href'), ...box(el) })),
          badges: [...document.querySelectorAll('.hero-badges > div')].map(el => ({ text: el.textContent.trim(), ...box(el) })),
          cue: box(document.querySelector('.hero-scroll')), radar: { x: center.x, y: center.y, width: 2 * Math.hypot(edge.x - center.x, edge.y - center.y) },
          geometry: document.querySelector('.hero-radar-dial').innerHTML, frame: { border: copyStyle.borderWidth, shadow: copyStyle.boxShadow } };
      });
      assert.equal(state.overflow, false, `${theme} ${width}x${height}: horizontal overflow`);
      assert.equal(state.imageFit, 'contain'); assert.ok(state.hero.height >= height);
      assert.ok(state.drone.x >= 0 && state.drone.right <= width, `${width}x${height}: propellers must fit`);
      assert.ok(state.drone.y >= state.nav.bottom && state.drone.bottom < state.title.y, `${width}x${height}: navbar, aircraft and title must not collide`);
      assert.deepEqual(state.lines.map(l => l.text), ['SOLUCIONES AÉREAS', 'INTELIGENTES']);
      assert.deepEqual(state.buttons.map(b => b.href), ['/contacto', '#servicios']);
      assert.deepEqual(state.badges.map(b => b.text), ['Certificado AESA', 'Tecnología RTK', 'Cobertura Nacional']);
      for (const el of [...state.lines, ...state.buttons, ...state.badges]) {
        assert.ok(el.x >= 0 && el.right <= width && el.bottom <= height, `${theme} ${width}x${height}: content must fit`);
      }
      assert.ok(state.radar.width <= width * 1.36);
      assert.ok(Math.abs(state.radar.x - (state.hero.x + state.hero.width / 2)) < 0.1);
      assert.ok(Math.abs(state.radar.y - (state.hero.y + state.hero.height / 2)) < 0.1);
      const [first, second] = state.buttons;
      if (Math.abs(first.y - second.y) < 0.1) {
        assert.ok(Math.abs(first.width - second.width) < 0.1);
        assert.ok(Math.abs((first.right + second.x) / 2 - state.radar.x) < 0.1);
      } else {
        for (const button of state.buttons) assert.ok(Math.abs(button.x + button.width / 2 - state.radar.x) < 0.1);
      }
      assert.ok(Math.max(...state.badges.map(b => b.bottom)) + 8 <= state.cue.y); assert.ok(state.cue.bottom <= height);
      assert.deepEqual(state.frame, { border: '0px', shadow: 'none' });
      if (theme === 'light') {
        const dark = report.states.find(s => s.theme === 'dark' && s.width === width && s.height === height);
        for (const key of ['drone', 'title', 'radar', 'lines', 'buttons', 'badges', 'cue', 'geometry']) assert.deepEqual(state[key], dark[key], `${width}x${height}: same geometry in both themes`);
      }
      if ([320, 768, 1024, 1395].includes(width) && ![820, 1366].includes(height)) {
        const axe = await new AxeBuilder({ page }).include('#inicio').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        report.accessibility.push({ theme, width, height, violations: axe.violations.map(v => v.id), incomplete: axe.incomplete.map(v => v.id) });
        assert.deepEqual(axe.violations, []);
      }
      report.states.push({ theme, width, height, ...state });
      if (process.env.HERO_SCREENSHOT_DIR && [320, 768, 1395].includes(width)) {
        await mkdir(process.env.HERO_SCREENSHOT_DIR, { recursive: true });
        await page.locator('#inicio').screenshot({ path: `${process.env.HERO_SCREENSHOT_DIR}/${theme}-${width}-${height}.png` });
      }
    }
    await page.getByRole('link', { name: 'Solicitar Servicio', exact: true }).click(); await page.waitForURL('**/contacto');
    await page.locator('main h1').waitFor(); report.contact = true;
    await page.goBack(); await page.waitForFunction(() => document.documentElement.dataset.hydrated === 'true');
    await page.getByRole('link', { name: 'Explorar Servicios', exact: true }).click();
    await page.waitForFunction(() => location.hash === '#servicios' && scrollY > 0); report.services = true;
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  console.log(`PASS: ${report.states.length} hero states, ${report.accessibility.length} accessibility checks, both themes, aircraft/controls visible and no overflow.`);
} finally {
  await browser.close();
  if (process.env.HERO_E2E_REPORT) await writeFile(process.env.HERO_E2E_REPORT, JSON.stringify(report, null, 2));
}
