import { test, expect, type Page } from '@playwright/test';

type Theme = 'light' | 'dark';
type Frame = { theme: string; background: string; src: string; srcset: string };
declare global { interface Window { themeAuditFrames: Frame[]; themeAuditActive: boolean } }

async function instrument(page: Page) {
  await page.addInitScript(() => {
    window.themeAuditFrames = []; window.themeAuditActive = true;
    const sample = () => {
      const home = document.querySelector('.home-page');
      const image = document.querySelector<HTMLImageElement>('.hero-image');
      if (home && image && window.themeAuditActive) window.themeAuditFrames.push({
        theme: document.documentElement.className,
        background: getComputedStyle(document.body).backgroundColor,
        src: image.getAttribute('src'), srcset: image.getAttribute('srcset'),
      });
      if (window.themeAuditActive && window.themeAuditFrames.length < 120) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function expectTheme(page: Page, theme: Theme) {
  await expect(page.locator('html')).toHaveClass(theme);
  await expect.poll(() => page.locator('html').evaluate(root => root.style.colorScheme)).toBe(theme);
  expect((await page.locator('body').getAttribute('class')) || '').not.toMatch(/\b(light|dark)\b/);
  const attribute = await page.locator('html').getAttribute('data-theme');
  if (attribute !== null) expect(attribute).toBe(theme);
  await expect(page.getByRole('button', { name: theme === 'light' ? 'Activar tema oscuro' : 'Activar tema claro', exact: true })).toBeVisible();
}

async function expectHome(page: Page, theme: Theme, before?: string, firstPaint = true) {
  await expectTheme(page, theme);
  const image = page.locator('.hero-image');
  await expect(image).toHaveAttribute('src', '/images/hero_claro.webp');
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  const source = await image.evaluate((img: HTMLImageElement) => img.currentSrc);
  expect(source).toContain('/images/hero-claro-');
  if (before) expect(source).toBe(before);
  expect(await page.locator('.hero-copy').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  if (firstPaint) {
    const frames = await page.evaluate(() => { window.themeAuditActive = false; return window.themeAuditFrames; });
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame.theme).toBe(theme);
      expect(frame.background).toBe(theme === 'light' ? 'rgb(245, 247, 250)' : 'rgb(7, 7, 9)');
      expect(frame.src).toBe('/images/hero_claro.webp');
      expect(frame.srcset).not.toContain('oscuro');
    }
  }
  return source;
}

async function openHome(page: Page, saved: Theme | 'system' | null) {
  await page.goto('/healthz'); // Establish the real origin before setting the test preference.
  await page.evaluate(value => { if (value) localStorage.setItem('theme', value); else localStorage.removeItem('theme'); }, saved);
  await page.goto('/');
}

for (const width of [390, 1440]) for (const saved of ['light', 'dark'] as const) for (const system of ['light', 'dark'] as const) {
  test(`theme ${saved}, system ${system}, refresh and stable hero at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: system });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400 && ['script', 'stylesheet', 'image', 'font'].includes(response.request().resourceType())) errors.push(`asset ${response.status()} ${response.url()}`); });
    await instrument(page); await openHome(page, saved);
    const source = await expectHome(page, saved);
    await page.reload(); await expectHome(page, saved, source);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.reload(); await expectHome(page, saved, source);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
    const opposite = saved === 'light' ? 'dark' : 'light';
    await page.getByRole('button', { name: saved === 'light' ? 'Activar tema oscuro' : 'Activar tema claro', exact: true }).click();
    await expectHome(page, opposite, source, false);
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe(opposite);
    await page.reload(); await expectHome(page, opposite, source);
    await page.getByRole('button', { name: opposite === 'light' ? 'Activar tema oscuro' : 'Activar tema claro', exact: true }).click();
    await expectHome(page, saved, source, false);
    for (const route of ['/blog', '/tecnologia']) {
      if (width < 1440) await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
      await page.getByRole('link', { name: route === '/blog' ? 'Blog' : 'Tecnología', exact: true }).filter({ visible: true }).first().click();
      await expect(page).toHaveURL(new RegExp(`${route}$`)); await expectTheme(page, saved);
      await page.locator('nav a[href="/"]').first().click();
      await expect(page).toHaveURL(/\/$/); await expectHome(page, saved, source, false);
    }
    await page.emulateMedia({ colorScheme: system === 'light' ? 'dark' : 'light' });
    await expectHome(page, saved, source, false);
    const tab = await context.newPage(); await tab.setViewportSize({ width, height: 900 });
    await instrument(tab); await tab.goto('/'); await expectHome(tab, saved, source);
    await tab.close();
    await page.screenshot({ path: testInfo.outputPath(`${saved}-${width}.png`) });
    expect(errors).toEqual([]);
  });
}

for (const system of ['light', 'dark'] as const) for (const saved of [null, 'system'] as const) {
  test(`fallback ${saved ?? 'absent'} follows system ${system} without swapping images`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: system }); await instrument(page); await openHome(page, saved);
    const source = await expectHome(page, system);
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe(saved);
    const next = system === 'light' ? 'dark' : 'light';
    await page.emulateMedia({ colorScheme: next }); await expectHome(page, next, source, false);
  });
}

test('manual choice synchronizes existing tabs', async ({ page, context }) => {
  await instrument(page); await openHome(page, 'light'); const source = await expectHome(page, 'light');
  const tab = await context.newPage(); await instrument(tab); await tab.goto('/'); await expectHome(tab, 'light', source);
  await page.getByRole('button', { name: 'Activar tema oscuro', exact: true }).click();
  await expectHome(page, 'dark', source, false); await expectHome(tab, 'dark', source, false);
  await tab.getByRole('button', { name: 'Activar tema claro', exact: true }).click();
  await expectHome(page, 'light', source, false); await expectHome(tab, 'light', source, false);
});

for (const theme of ['light', 'dark'] as const) test(`slow initialization cannot paint the opposite theme: ${theme}`, async ({ page }) => {
  await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
  await instrument(page);
  await page.route('**/assets/theme-init-*.js', async route => {
    await new Promise(resolve => setTimeout(resolve, 350)); await route.continue();
  });
  await openHome(page, theme); await expectHome(page, theme);
});
