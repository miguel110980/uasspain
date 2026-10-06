import { chromium } from '../../frontend/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const origin = process.env.HERO_ORIGIN || 'https://localhost';
const report = { origin, states: [], errors: [], warnings: [] };
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.1, `${message}: ${actual} vs ${expected}`);
const browser = await chromium.launch();
try {
  for (const theme of ['dark', 'light']) for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [1024, 768], [1395, 1127], [1440, 900], [2560, 1440], [844, 390]]) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height }, reducedMotion: 'no-preference' });
    await context.addInitScript(value => localStorage.setItem('theme', value), theme);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); if (message.type() === 'warning') report.warnings.push(message.text()); });
    await page.goto(origin + '/');
    await page.waitForFunction(() => document.documentElement.dataset.hydrated === 'true');
    await page.evaluate(() => document.fonts.ready);
    const sweep = page.locator('.hero-radar-sweep');
    const before = await sweep.evaluate(el => el.getAnimations()[0].currentTime);
    await page.waitForTimeout(100);
    assert.ok(await sweep.evaluate(el => el.getAnimations()[0].currentTime) > before, 'Sweep must advance automatically');
    const state = { theme, width, height, phases: [] };
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
      const measured = await sweep.evaluate((el, phase) => {
        const animation = el.getAnimations()[0]; animation.pause();
        const timing = animation.effect.getTiming(); animation.currentTime = timing.duration * phase;
        const rings = [...document.querySelectorAll('.hero-radar-ring')], ring = rings[0];
        const cx = ring.cx.baseVal.value, cy = ring.cy.baseVal.value, matrix = ring.getScreenCTM();
        const point = (x, y, element = ring) => { const p = new DOMPoint(x, y).matrixTransform(element.getScreenCTM()); return { x: p.x, y: p.y }; };
        const center = point(cx, cy), hero = document.querySelector('#inicio').getBoundingClientRect();
        const dial = document.querySelector('.hero-radar-dial').viewBox.baseVal;
        const arcs = [...document.querySelectorAll('.hero-radar-arc')].map(path => {
          const length = path.getTotalLength(), points = Array.from({ length: 33 }, (_, index) => path.getPointAtLength(length * index / 32));
          const track = document.getElementById(path.dataset.radarTrack);
          return { length, trackRadius: track.r.baseVal.value, offset: Number(path.dataset.radarOffset), radii: points.map(p => Math.hypot(p.x - cx, p.y - cy)), start: { x: points[0].x, y: points[0].y }, end: { x: points.at(-1).x, y: points.at(-1).y } };
        });
        const dotted = rings.filter(r => r.hasAttribute('stroke-dasharray')).map(r => ({
          normalizedLength: r.pathLength.baseVal, pattern: r.getAttribute('stroke-dasharray').split(/\s+/).map(Number),
          offset: Number(r.getAttribute('stroke-dashoffset')), cap: r.getAttribute('stroke-linecap'),
        }));
        const ray = el.querySelector('path[stroke="url(#hero-radar-ray)"]'), start = ray.getPointAtLength(0), end = ray.getPointAtLength(ray.getTotalLength());
        const dot = el.querySelector('.hero-radar-sweep-dot'), dx = dot.cx.baseVal.value - cx, dy = dot.cy.baseVal.value - cy;
        const rx = end.x - cx, ry = end.y - cy;
        const photo = document.querySelector('.hero-image').getBoundingClientRect();
        const axes = document.querySelector('.hero-radar-axis').getBBox();
        const maskCenter = point(836, 470.5, document.querySelector('.hero-radar-mask-desktop'));
        return { center, heroCenter: { x: hero.x + hero.width / 2, y: hero.y + hero.height / 2 },
          viewBoxCenter: { x: dial.x + dial.width / 2, y: dial.y + dial.height / 2 }, axesCenter: { x: axes.x + axes.width / 2, y: axes.y + axes.height / 2 }, cx, cy,
          rings: rings.map(r => ({ cx: r.cx.baseVal.value, cy: r.cy.baseVal.value, radius: r.r.baseVal.value })), arcs, dotted,
          scale: { x: Math.hypot(matrix.a, matrix.b), y: Math.hypot(matrix.c, matrix.d), shear: matrix.a * matrix.c + matrix.b * matrix.d },
          rayOrigin: point(start.x, start.y, ray), dot: point(dot.cx.baseVal.value, dot.cy.baseVal.value, dot),
          dotOnRayError: Math.abs(dx * ry - dy * rx) / Math.hypot(rx, ry), dotRadius: Math.hypot(dx, dy),
          photoCenter: { x: photo.x + photo.width / 2, y: photo.y + photo.height / 2 }, maskCenter,
          duration: timing.duration, easing: timing.easing, infinite: timing.iterations === Infinity,
          title: document.querySelector('.hero-title').getBoundingClientRect().toJSON() };
      }, fraction);
      near(measured.cx, measured.viewBoxCenter.x, 'SVG center X'); near(measured.cy, measured.viewBoxCenter.y, 'SVG center Y');
      near(measured.axesCenter.x, measured.cx, 'Axes center X'); near(measured.axesCenter.y, measured.cy, 'Axes center Y');
      for (const axis of ['x', 'y']) {
        near(measured.center[axis], measured.heroCenter[axis], 'Page center');
        near(measured.rayOrigin[axis], measured.center[axis], 'Sweep pivot');
        near(measured.maskCenter[axis], measured.photoCenter[axis], 'Mask remains aligned with original photograph');
      }
      near(measured.scale.x, measured.scale.y, 'Uniform scaling'); near(measured.scale.shear, 0, 'No shear');
      assert.equal(measured.rings.length, 7);
      for (const ring of measured.rings) { near(ring.cx, measured.cx, 'Concentric X'); near(ring.cy, measured.cy, 'Concentric Y'); }
      assert.equal(measured.arcs.length, 8);
      for (const arc of measured.arcs) for (const radius of arc.radii) near(radius, arc.radii[0], 'Every arc follows a circle');
      for (const arc of measured.arcs) {
        near(arc.length, measured.arcs[0].length, 'All highlighted segments have equal physical lengths');
        near(arc.radii[0], arc.trackRadius + arc.offset, 'Arc follows its declared ring or parallel edge');
      }
      for (const [left, right] of [[0, 1], [2, 3], [4, 5], [7, 6]]) {
        near(measured.arcs[left].start.x + measured.arcs[right].end.x, measured.cx * 2, 'Mirror endpoints X');
        near(measured.arcs[left].start.y, measured.arcs[right].end.y, 'Mirror endpoints Y');
      }
      assert.equal(measured.dotted.length, 3);
      for (const ring of measured.dotted) {
        const period = ring.pattern.reduce((sum, value) => sum + value, 0), count = ring.normalizedLength / period;
        near(count, Math.round(count), 'Dotted circle closes with complete periods');
        assert.equal(Math.round(count) % 4, 0, 'Dots mirror across all four quadrants');
        near(ring.offset, ring.pattern[0] / 2, 'The closing dot is centered on the axis');
        assert.equal(ring.cap, 'round');
      }
      near(measured.dotOnRayError, 0, 'Luminous point lies on sweep ray'); assert.ok(measured.dotRadius > 0);
      assert.equal(measured.duration, 12000); assert.equal(measured.easing, 'linear'); assert.equal(measured.infinite, true);
      if (state.phases.length) {
        assert.deepEqual(measured.title, state.phases[0].title);
        assert.deepEqual(measured.center, state.phases[0].center);
        near(Math.hypot(measured.dot.x - measured.center.x, measured.dot.y - measured.center.y), Math.hypot(state.phases[0].dot.x - measured.center.x, state.phases[0].dot.y - measured.center.y), 'Dot follows constant circular orbit');
        const angle = fraction * Math.PI * 2, first = state.phases[0];
        const dx = first.dot.x - first.center.x, dy = first.dot.y - first.center.y;
        near(measured.dot.x, measured.center.x + dx * Math.cos(angle) - dy * Math.sin(angle), 'Dot rotates with sweep X');
        near(measured.dot.y, measured.center.y + dx * Math.sin(angle) + dy * Math.cos(angle), 'Dot rotates with sweep Y');
      }
      state.phases.push(measured);
      if (process.env.HERO_SCREENSHOT_DIR && width === 1395 && fraction < 1) {
        await mkdir(process.env.HERO_SCREENSHOT_DIR, { recursive: true });
        await page.locator('#inicio').screenshot({ path: `${process.env.HERO_SCREENSHOT_DIR}/sweep-${theme}-${fraction * 360}.png` });
      }
    }
    await sweep.evaluate(el => el.getAnimations()[0].play());
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.hero-radar-sweep')).animationName === 'none');
    await page.waitForFunction(() => document.querySelector('.hero-radar-sweep').getAnimations().length === 0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => document.querySelector('.hero-radar-sweep').getAnimations()[0]?.playState === 'running');
    state.reducedMotion = true; state.resume = true;
    report.states.push(state); await context.close();
  }
  assert.deepEqual(report.errors, []);
  console.log(`PASS: ${report.states.length} HUD states, 80 rotation phases, concentric circles, equal arcs, centered pivot, moving dot and photo mask alignment.`);
} finally {
  await browser.close();
  if (process.env.HERO_RADAR_REPORT) await writeFile(process.env.HERO_RADAR_REPORT, JSON.stringify(report, null, 2));
}
