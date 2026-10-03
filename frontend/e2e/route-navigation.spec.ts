import { test, expect } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`initial services fragment survives rendering and reload at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#servicios');
    await expect(page.locator('#servicios')).toBeVisible();
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100);
    await page.reload();
    await expect(page.locator('#servicios')).toBeVisible();
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100);
  });
}

test('services anchor waits for a lazy home route', async ({ page }) => {
  await page.route('**/src/pages/Home.tsx*', async route => {
    await new Promise(resolve => setTimeout(resolve, 450));
    await route.continue();
  });
  await page.goto('/servicios/termografia');
  await page.locator('main a[href="/#servicios"]').click();
  await expect(page).toHaveURL(/\/#servicios$/);
  await expect(page.locator('#servicios')).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100);
});
