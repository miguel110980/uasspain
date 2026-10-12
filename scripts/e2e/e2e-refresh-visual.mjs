// Production first-paint regression: real HTTPS, no mocked API or hidden UI.
import { chromium } from '../../frontend/node_modules/playwright/index.mjs';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { X509Certificate, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const sharp = createRequire(new URL('../../frontend/package.json', import.meta.url))('sharp');

const origin = process.env.FRONTEND_TEST_ORIGIN || 'https://localhost';
assert.ok(['https://localhost', 'https://localhost:8444'].includes(origin));
const dir = process.env.REFRESH_REPORT_DIR || '.run/frontend-refresh-20261011/visual';
mkdirSync(dir, { recursive: true });
const pin = createHash('sha256').update(new X509Certificate(readFileSync('.secrets/tls/edge.crt')).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
const browser = await chromium.launch({ args: ['--ignore-certificate-errors-spki-list=' + pin] });
const sizes = [[320,568],[375,667],[390,844],[768,1024],[1024,768],[1366,768],[1440,900],[1920,1080],[2560,1440],[3840,2160],[844,390],[667,375]];
const report = { origin, states: [], failures: [], writes: [], errors: [] };

try {
  for (const theme of ['light', 'dark']) for (const [width,height] of sizes) {
    const context = await browser.newContext({ viewport: { width,height }, ignoreHTTPSErrors: false, colorScheme: theme === 'light' ? 'dark' : 'light' });
    await context.addInitScript(({ value, allowedOrigin }) => {
      if (window.top !== window || location.origin !== allowedOrigin) return;
      if (!localStorage.getItem('theme')) localStorage.setItem('theme', value);
      window.refreshFrames = []; window.refreshMetrics = { cls: 0, paint: [], lcp: [] }; window.refreshActive = true;
      for (const type of ['paint','largest-contentful-paint','layout-shift']) try {
        new PerformanceObserver(list => { for (const entry of list.getEntries()) {
          if (type === 'layout-shift' && !entry.hadRecentInput) window.refreshMetrics.cls += entry.value;
          else if (type === 'paint') window.refreshMetrics.paint.push({ name: entry.name, time: entry.startTime });
          else if (type === 'largest-contentful-paint') window.refreshMetrics.lcp.push(entry.startTime);
        }}).observe({ type, buffered: true });
      } catch {}
      const sample = () => {
        const image = document.querySelector('.hero-image');
        if (document.body && image) {
          const r = image.getBoundingClientRect();
          window.refreshFrames.push({ time: performance.now(), theme: document.documentElement.className,
            background: getComputedStyle(document.body).backgroundColor, width: document.documentElement.scrollWidth,
            loaded: Boolean(image.naturalWidth), source: image.currentSrc,
            edges: [...document.querySelectorAll('.hero-background img:not(.hero-image)')].map(i => ({ loaded: Boolean(i.naturalWidth), source: i.currentSrc })),
            art: { x:r.x,y:r.y,width:r.width,height:r.height },
            actionHeights: [...document.querySelectorAll('.hero-actions a')].map(a => a.getBoundingClientRect().height) });
        }
        if (window.refreshActive && window.refreshFrames.length < 240) requestAnimationFrame(sample);
      }; requestAnimationFrame(sample);
    }, { value: theme, allowedOrigin: origin });
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('request', r => { if (!['GET','HEAD','OPTIONS'].includes(r.method())) report.writes.push(r.method() + ' ' + r.url()); });
    const cdp = await context.newCDPSession(page); await cdp.send('Network.enable');
    for (const mode of ['cold','reload','hard','slow']) {
      const frames = [];
      const capture = async frame => { frames.push({ buffer: Buffer.from(frame.data, 'base64'), time: frame.metadata.timestamp }); await cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }); };
      cdp.on('Page.screencastFrame', capture);
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: mode !== 'reload' });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: mode === 'slow' ? 4 : 1 });
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: mode === 'slow' ? 150 : 0, downloadThroughput: mode === 'slow' ? 192000 : -1, uploadThroughput: mode === 'slow' ? 96000 : -1 });
      await cdp.send('Page.startScreencast', { format:'png',maxWidth:3840,maxHeight:2160,everyNthFrame:1 });
      if (mode === 'cold' || mode === 'slow') await page.goto(origin + '/', { waitUntil:'domcontentloaded' });
      else await page.reload({ waitUntil:'domcontentloaded' });
      await page.waitForFunction(() => document.documentElement.dataset.hydrated === 'true' && [...document.querySelectorAll('.hero-stage img')].length === 4 && [...document.querySelectorAll('.hero-stage img')].every(i => i.complete && i.naturalWidth));
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const data = await page.evaluate(() => {
        window.refreshActive = false;
        return { samples: window.refreshFrames, metrics: window.refreshMetrics, timeOrigin: performance.timeOrigin,
          resources: performance.getEntriesByType('resource').filter(r => /\/images\/hero/.test(r.name)).map(r => ({ url:r.name,bytes:r.transferSize })),
          finalHeights: [...document.querySelectorAll('.hero-actions a')].map(a => a.getBoundingClientRect().height) };
      });
      await cdp.send('Page.stopScreencast'); cdp.off('Page.screencastFrame', capture);
      const state = { theme,width,height,mode,frames:frames.length,metrics:data.metrics,resources:data.resources,blackBandFrames:0,photoFrames:0,sourceMismatches:0,themeFlashes:0,overflows:0,buttonHeightChanges:0,buttonHeightSamples:[] };
      for (const s of data.samples) {
        if (s.theme !== theme || s.background !== (theme === 'light' ? 'rgb(245, 247, 250)' : 'rgb(7, 7, 9)')) state.themeFlashes++;
        if (s.width !== width) state.overflows++;
        if (s.loaded && (s.edges.length !== 2 || s.edges.some(e => !e.loaded || e.source !== s.source))) state.sourceMismatches++;
        if (s.actionHeights.some((v,i) => Math.abs(v - data.finalHeights[i]) > 0.5)) { state.buttonHeightChanges++;state.buttonHeightSamples.push({time:s.time,heights:s.actionHeights,final:data.finalHeights}); }
      }
      const firstLoaded = data.samples.find(s => s.loaded);
      if (firstLoaded) for (const frame of frames) {
        if (frame.time * 1000 - data.timeOrigin < firstLoaded.time) continue;
        const { data:pixels,info } = await sharp(frame.buffer).removeAlpha().raw().toBuffer({ resolveWithObject:true });
        const xScale = info.width / width, yScale = info.height / height;
        const y = Math.max(0,Math.min(info.height-1,Math.round((firstLoaded.art.y + firstLoaded.art.height * .18) * yScale)));
        const brightness = x => { const offset = (y * info.width + Math.max(0,Math.min(info.width-1,Math.round(x * xScale)))) * info.channels; return Math.max(...pixels.subarray(offset,offset+3)); };
        const center = brightness(Math.max(20,firstLoaded.art.x + firstLoaded.art.width * .15));
        if (center > 40) { state.photoFrames++; if (brightness(8) <= 20 || brightness(width-8) <= 20) state.blackBandFrames++; }
      }
      if (frames.length && ['cold','slow'].includes(mode)) writeFileSync(`${dir}/${theme}-${width}-${height}-${mode}-first.png`, frames[0].buffer);
      await page.screenshot({ path:`${dir}/${theme}-${width}-${height}-${mode}-final.png` });
      report.states.push(state);
      for (const key of ['blackBandFrames','sourceMismatches','themeFlashes','overflows','buttonHeightChanges']) if (state[key]) report.failures.push({ theme,width,height,mode,key,count:state[key] });
      assert.ok(frames.length, 'First-paint frames must be captured');
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate:1 });
    await cdp.send('Network.emulateNetworkConditions', { offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1 });
    await page.getByRole('button', { name:theme === 'light' ? 'Activar tema oscuro' : 'Activar tema claro', exact:true }).click();
    await page.waitForFunction(t => document.documentElement.className === t, theme === 'light' ? 'dark' : 'light');
    await page.reload(); assert.equal(await page.locator('html').getAttribute('class'), theme === 'light' ? 'dark' : 'light');
    await page.goto(origin + '/contacto'); await page.locator('h1').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth),width);
    await context.setOffline(true); await context.setOffline(false);
    await page.goto(origin + '/'); await page.locator('.hero-image').waitFor();
    await context.close();
    writeFileSync(dir+'/report.json',JSON.stringify(report,null,2));
    console.log(`${theme} ${width}x${height}: four navigation modes, theme/reload, inner route and reconnect checked`);
  }
} finally { await browser.close(); writeFileSync(dir+'/report.json',JSON.stringify(report,null,2)); }
assert.deepEqual(report.writes, [], 'Public visual tests must not modify MAIN data');
assert.deepEqual(report.errors, [], 'No uncaught application errors');
assert.deepEqual(report.failures, [], 'Inspect the measured visual regression report');
console.log(JSON.stringify({ result:'PASS',states:report.states.length,capturedFrames:report.states.reduce((n,s)=>n+s.frames,0),mainWrites:0 }));
