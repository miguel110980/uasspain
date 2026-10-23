import { expect, test } from '@playwright/test';
import fixture from '../scripts/ui-fixtures.mjs';

// UI contract cases on the served build. No real credentials or business writes.
for (const scenario of ['tls-pending', 'stale-verification', 'verified-current-origin']) {
  test(`Google administration explains activation: ${scenario}`, async ({ page, context, baseURL }) => {
    const current = scenario === 'verified-current-origin';
    const origin = current ? new URL(baseURL!).origin : 'https://www.uasspain-prueba.duckdns.org';
    const profile = fixture.profiles.find(p => p.role === 'admin');
    const writes: string[] = [];
    await context.routeWebSocket('**/ws/**', socket => socket.onMessage(() => {}));
    await page.route(url => url.pathname.startsWith('/api/'), route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (request.method() !== 'GET') writes.push(path);
      if (path === '/api/auth/me/') return route.fulfill({ json: { ...profile, session_role: 'admin', profile } });
      if (path === '/api/system/status/') return route.fulfill({ json: fixture.status });
      if (path === '/api/system/google-oauth/') return route.fulfill({ json: {
        enabled: false, client_id: '1234-fixture.apps.googleusercontent.com', corporate_email: 'info@uasspain.com', revision: 1,
        client_secret_configured: true, verified_at: scenario === 'tls-pending' ? null : '2026-10-01T00:00:00Z', verified: current,
        transport_ready: scenario !== 'tls-pending', status: scenario === 'tls-pending' ? 'BLOCKED_PUBLIC_TLS' : current ? 'VERIFIED_DISABLED' : 'CONFIGURED_PENDING_VERIFICATION',
        linked: false, public_origin: origin, redirect_uri: origin + '/auth/google/callback',
      } });
      return route.fulfill({ json: [] });
    });
    await page.goto('/admin?section=configuracion&tab=integraciones');
    const section = page.getByRole('region', { name: 'Google OAuth administrativo' });
    // A named section maps to region; all assertions are scoped to this module.
    await expect(section.getByText(origin + '/auth/google/callback', { exact: true })).toBeVisible();
    await expect(section.getByText(/Secreto cifrado disponible/)).toBeVisible();
    const checkbox = section.getByLabel('Habilitar acceso Google verificado');
    if (current) {
      await expect(checkbox).toBeEnabled();
      await section.getByLabel('Google OAuth Client ID', { exact: true }).fill('changed-fixture.apps.googleusercontent.com');
      await expect(checkbox).toBeDisabled();
      await expect(section.locator('#google-activation-reason')).toContainText('Guarde los cambios');
    } else {
      await expect(checkbox).toBeDisabled();
      await section.getByLabel('Contraseña actual para verificar, vincular o desvincular').fill('synthetic-password');
      await expect(section.getByRole('button', { name: 'Verificar con Google', exact: true })).toBeDisabled();
      await expect(section.locator('#google-activation-reason')).toContainText(scenario === 'tls-pending' ? 'HTTPS público pendiente' : 'El secreto guardado no acredita');
    }
    for (const width of [320, 1440]) { await page.setViewportSize({ width, height: 900 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
    expect(writes.filter(path => !path.includes('/auth/'))).toEqual([]);
  });
}
