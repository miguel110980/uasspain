// Real deployed Home: usable prerender, stable hydration and early button clicks.
// Network delay belongs exclusively to this functional test, never Lighthouse.
import { chromium } from '../../frontend/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const origin = process.env.FRONTEND_TEST_ORIGIN || 'https://localhost';
const report = { prerender: false, earlyAccess: false, reusedHeading: false, mobileMenu: false, theme: false, errors: [] };
const browser = await chromium.launch();
try {
  const staticContext = await browser.newContext({ ignoreHTTPSErrors: true, javaScriptEnabled: false });
  const staticPage = await staticContext.newPage();
  await staticPage.goto(origin);
  await staticPage.locator('main h1').waitFor();
  assert.ok(await staticPage.locator('main h1').innerText());
  assert.ok(await staticPage.getByRole('link', { name: 'Tecnología', exact: true }).first().isVisible());
  report.prerender = true;
  await staticContext.close();

  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  let requested;
  const loading = new Promise(resolve => { requested = resolve; });
  await page.route('**/assets/App-*.js', async route => { requested(); await hold; await route.continue(); });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('main h1').waitFor();
  await loading;
  await page.evaluate(() => { window.originalHeading = document.querySelector('main h1'); });
  await page.getByRole('button', { name: 'Acceso', exact: true }).click();
  release();
  await page.waitForFunction(() => document.documentElement.dataset.hydrated === 'true');
  console.log('Hydrated:', await page.evaluate(() => ({ headingReused: window.originalHeading === document.querySelector('main h1'), inputs: [...document.querySelectorAll('input')].map(input => input.id), dialogs: [...document.querySelectorAll('[role=dialog]')].map(dialog => dialog.getAttribute('aria-label')) })));
  await page.getByLabel('Correo electrónico *', { exact: true }).waitFor();
  report.earlyAccess = true;
  report.reusedHeading = await page.evaluate(() => window.originalHeading === document.querySelector('main h1'));
  assert.equal(report.reusedHeading, true, 'Hydration must reuse the visible prerendered heading');
  await context.close();

  const mobile = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const mobilePage = await mobile.newPage();
  mobilePage.on('pageerror', error => report.errors.push(error.message));
  await mobilePage.goto(origin);
  await mobilePage.waitForFunction(() => document.documentElement.dataset.hydrated === 'true');
  const before = await mobilePage.evaluate(() => document.documentElement.classList.contains('dark'));
  await mobilePage.getByRole('button', { name: /Activar tema/ }).click();
  await mobilePage.waitForFunction(value => document.documentElement.classList.contains('dark') !== value, before);
  report.theme = true;
  await mobilePage.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  await mobilePage.getByRole('dialog', { name: 'Menú de navegación', exact: true }).waitFor();
  await mobilePage.getByRole('button', { name: 'Cerrar menú', exact: true }).click();
  await mobilePage.getByRole('dialog', { name: 'Menú de navegación', exact: true }).waitFor({ state: 'hidden' });
  report.mobileMenu = true;
  assert.deepEqual(report.errors, []);
  await mobile.close();
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  await mkdir('.run/home100', { recursive: true });
  await writeFile('.run/home100/rendering.json', JSON.stringify(report, null, 2));
}
