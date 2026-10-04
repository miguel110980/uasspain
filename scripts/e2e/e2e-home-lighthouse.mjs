// Audit the real production server with Lighthouse's standard mobile settings.
// No request interception, alternate content, disabled features or score overrides.
import lighthouse from '../../frontend/node_modules/lighthouse/core/index.js';
import { launch } from '../../frontend/node_modules/chrome-launcher/dist/index.js';
import { chromium } from '../../frontend/node_modules/playwright/index.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import assert from 'node:assert/strict';

const baseline = process.argv.includes('--baseline');
const origin = new URL(process.env.FRONTEND_TEST_ORIGIN || 'https://localhost').origin;
assert.equal(new URL(origin).protocol, 'https:', 'Audit the production HTTPS origin');
const folder = path.resolve(process.env.LIGHTHOUSE_REPORT_DIR || '.run/home100');
await mkdir(folder, { recursive: true });
const ca = await readFile(process.env.FRONTEND_TEST_CA || '.secrets/tls/ca.crt');
await new Promise((resolve, reject) => {
  const request = https.get(origin + '/', { ca, timeout: 15000 }, response => {
    response.resume();
    response.on('end', () => {
      try {
        assert.equal(response.statusCode, 200);
        assert.match(response.headers['content-type'], /text\/html/);
        resolve();
      } catch (error) { reject(error); }
    });
  });
  request.on('error', reject);
  request.on('timeout', () => request.destroy(new Error('Production HTTPS timeout')));
});
const runs = [];
for (let index = 1; index <= (baseline ? 1 : 3); index++) {
  const chrome = await launch({ chromePath: chromium.executablePath(), chromeFlags: ['--headless', '--ignore-certificate-errors', '--no-sandbox'] });
  try {
    const result = await lighthouse(origin + '/', {
      port: chrome.port, logLevel: 'error', output: 'html',
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
    });
    assert.ok(result?.lhr, 'Missing Lighthouse result');
    assert.equal(result.lhr.runtimeError, undefined, 'Lighthouse runtime error');
    const scores = Object.fromEntries(Object.entries(result.lhr.categories).map(([key, category]) => [key, Math.round(category.score * 100)]));
    const metrics = Object.fromEntries(['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index']
      .map(key => [key, result.lhr.audits[key].numericValue]));
    const record = { run: index, scores, metrics, version: result.lhr.lighthouseVersion, fetchedAt: result.lhr.fetchTime, settings: result.lhr.configSettings };
    runs.push(record);
    const name = baseline ? 'baseline' : `final-${index}`;
    if (process.env.LIGHTHOUSE_DEBUG === '1') {
      await writeFile(path.join(folder, `${name}-artifacts.json`), JSON.stringify(result.artifacts));
    }
    await writeFile(path.join(folder, `${name}.json`), JSON.stringify(result.lhr));
    await writeFile(path.join(folder, `${name}.html`), result.report);
    console.log(JSON.stringify(record));
  } finally { await chrome.kill(); }
}
await writeFile(path.join(folder, baseline ? 'baseline-summary.json' : 'final-summary.json'), JSON.stringify({ origin, baseline, runs }, null, 2));
if (!baseline) {
  for (const run of runs) for (const [category, score] of Object.entries(run.scores)) {
    assert.equal(score, 100, `Run ${run.run}: ${category} must score 100`);
  }
  console.log('PASS: three consecutive standard mobile Lighthouse runs score 100/100/100/100.');
}
