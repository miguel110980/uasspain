import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fixture from '../scripts/ui-fixtures.mjs';

async function setup(page: Page, initial = { enabled: false, required_roles: ['instructor'] }) {
  const profile = fixture.profiles.find(p => p.role === 'admin');
  const state = { policy: structuredClone(initial), puts: [] as unknown[], reads: 0, rejected: false, unavailable: false };
  await page.context().routeWebSocket('**/ws/**', socket => socket.onMessage(() => {}));
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me/') return route.fulfill({ json: { ...profile, profile, session_role: 'admin' } });
    if (path === '/api/profiles/') return route.fulfill({ json: fixture.profiles });
    if (path === '/api/system/status/') return route.fulfill({ json: { ...fixture.status, two_factor: state.policy } });
    if (path === '/api/system/auth-policy/') {
      if (route.request().method() === 'GET') {
        state.reads++; return route.fulfill({ status: state.unavailable ? 403 : 200, json: state.unavailable ? { detail: 'Sin permisos para administrar 2FA.' } : state.policy });
      }
      state.puts.push(route.request().postDataJSON());
      if (state.rejected) return route.fulfill({ status: 400, json: { detail: 'La política no se ha guardado: verifique el remitente automático.' } });
      state.policy = route.request().postDataJSON(); return route.fulfill({ json: state.policy });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/admin?section=configuracion');
  return state;
}
const form = (page: Page) => page.getByRole('region', { name: 'Administración 2FA/OTP', exact: true });
const enabled = (page: Page) => form(page).getByRole('checkbox', { name: /^Activar 2FA/ });
async function open(page: Page) { await page.getByRole('button', { name: 'Seguridad', exact: true }).last().click(); await expect(enabled(page)).toBeEnabled(); }

test('configuration links its 2FA summary to the original controls without saving on load', async ({ page }) => {
  const state = await setup(page); await page.getByRole('button', { name: 'Integraciones', exact: true }).click();
  await expect(page.getByText('2FA por roles', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Administrar 2FA/OTP', exact: true }).click();
  await expect(enabled(page)).toBeEnabled(); await expect(enabled(page)).not.toBeChecked();
  await expect(form(page).getByRole('checkbox', { name: 'instructor', exact: true })).toBeChecked();
  expect(state.puts).toEqual([]);
});

test('enable, role edits and disable use the existing endpoint and survive reload', async ({ page }) => {
  const state = await setup(page); await open(page); await enabled(page).click();
  await expect(enabled(page)).toBeChecked(); expect(state.policy).toEqual({ enabled: true, required_roles: ['instructor'] });
  await form(page).getByRole('checkbox', { name: 'alumno', exact: true }).click();
  await expect(form(page).getByRole('checkbox', { name: 'alumno', exact: true })).toBeChecked();
  await page.reload(); await open(page); await expect(enabled(page)).toBeChecked();
  await expect(form(page).getByRole('checkbox', { name: 'instructor', exact: true })).toBeChecked();
  await enabled(page).click(); await expect(enabled(page)).not.toBeChecked();
  await page.reload(); await open(page); await expect(enabled(page)).not.toBeChecked();
  expect(state.policy.required_roles).toEqual(['instructor', 'alumno']); expect(state.puts).toHaveLength(3);
});

test('rejected saves retain confirmed policy, show the error and never report success', async ({ page }) => {
  const state = await setup(page); state.rejected = true; await open(page); await enabled(page).click();
  await expect(form(page).getByRole('alert')).toContainText('La política no se ha guardado');
  await expect(enabled(page)).not.toBeChecked(); await expect(form(page).getByText('Política 2FA/OTP guardada correctamente.', { exact: true })).toHaveCount(0);
  expect(state.policy.enabled).toBe(false); await page.reload(); await open(page); await expect(enabled(page)).not.toBeChecked();
});

test('denied reads leave controls disabled and can be retried without any write', async ({ page }) => {
  const state = await setup(page); state.unavailable = true;
  await page.getByRole('button', { name: 'Seguridad', exact: true }).last().click();
  await expect(form(page).getByRole('alert')).toContainText('Sin permisos'); await expect(enabled(page)).toBeDisabled(); expect(state.puts).toEqual([]);
  state.unavailable = false; await form(page).getByRole('button', { name: 'Reintentar carga de 2FA/OTP' }).click(); await expect(enabled(page)).toBeEnabled();
  expect(state.puts).toEqual([]);
});

test('the existing Security screen uses the same confirmed policy controls', async ({ page }) => {
  const state = await setup(page, { enabled: true, required_roles: ['alumno'] });
  await page.getByRole('button', { name: 'Seguridad', exact: true }).first().click();
  await expect(enabled(page)).toBeEnabled(); await expect(enabled(page)).toBeChecked();
  await enabled(page).click(); await expect(enabled(page)).not.toBeChecked(); expect(state.policy.enabled).toBe(false);
});

test('policy controls remain keyboard accessible and responsive in light and dark themes', async ({ page }) => {
  await setup(page); await open(page);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(t => { localStorage.setItem('theme', t); window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: t, storageArea: localStorage })); }, theme);
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const box = await form(page).boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      expect((await new AxeBuilder({ page }).include('section[aria-label="Administración 2FA/OTP"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    }
  }
  await enabled(page).focus(); await page.keyboard.press('Space'); await expect(enabled(page)).toBeChecked();
});
