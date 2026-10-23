import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { sql, adminClient } from '../../scripts/e2e/auth-fixtures.mjs';

test('Google configuration, signed code flow, explicit link, safe unlink and conventional login', async ({ page, context }, testInfo) => {
  test.setTimeout(240000); expect(testInfo.project.use.baseURL).toBe('https://localhost:8444');
  const actor = (await (await adminClient()).call('/api/auth/me/')).body.id;
  const q = (v: string) => `'${v.replaceAll("'", "''")}'`;
  const beforeSetting = sql("SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]') FROM core_systemsetting s WHERE key='google_oauth'");
  const beforeSecrets = sql("SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]') FROM core_systemsecret s WHERE key='google_oauth_client_secret'");
  const beforeSubject = sql(`SELECT COALESCE(google_subject_lookup,'') FROM accounts_userprofile WHERE id=${q(actor)}`);
  const beforeFlows = new Set(sql('SELECT id FROM google_oauth_flow').split('\n').filter(Boolean));
  const corporateMail = sql("SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY key),'[]') FROM core_systemsetting s WHERE key IN ('smtp','mail_mode','mail_api','mail_api_draft')");
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const subject = randomUUID();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('https://accounts.google.com/o/oauth2/v2/auth?*', async route => {
    const response = await fetch('http://127.0.0.1:8072/fixtures/issue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ authorization_url: route.request().url(), subject }) });
    const ticket = await response.json();
    const target = new URL(ticket.redirect_uri); target.searchParams.set('code', ticket.code); target.searchParams.set('state', ticket.state);
    await route.fulfill({ status: 302, headers: { Location: target.toString() }, body: '' });
  });
  const login = async () => {
    await page.goto('/?auth=login'); await page.getByLabel('Correo electrónico *', { exact: true }).fill('e2e-admin@test.local');
    await page.getByLabel('Contraseña *', { exact: true }).fill('E2eAdmin_2026!'); // pragma: allowlist secret - isolated fixture
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click(); await expect(page).toHaveURL(/\/admin$/);
    await page.goto('/admin?section=configuracion&tab=integraciones');
  };
  try {
    await login(); const form = page.getByRole('form', { name: 'Configuración Google OAuth', exact: true });
    await expect(form.getByLabel('Habilitar acceso Google verificado')).toBeDisabled();
    await form.getByLabel('Google OAuth Client ID', { exact: true }).fill('1234-uasspain-fixture.apps.googleusercontent.com');
    await form.getByLabel('Google OAuth Client Secret', { exact: true }).fill('synthetic-google-oauth-secret'); // pragma: allowlist secret - synthetic provider
    const saved = page.waitForResponse(r => r.url().endsWith('/api/system/google-oauth/') && r.request().method() === 'PUT');
    await form.getByRole('button', { name: 'Guardar configuración Google' }).click(); expect((await saved).status()).toBe(200);
    await expect(form.getByLabel('Google OAuth Client Secret', { exact: true })).toHaveValue('');
    await expect(page.getByText('Configurar Google Cloud Console', { exact: true }).locator('..')).toHaveAttribute('open', '');
    await page.getByRole('button', { name: 'Copiar origen autorizado de javascript', exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://localhost:8444');
    await page.getByRole('button', { name: 'Copiar url de redirección autorizada', exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://localhost:8444/auth/google/callback');
    for (const theme of ['light', 'dark']) for (const width of [320, 390, 768, 1440]) {
      await page.evaluate(t => { document.documentElement.classList.toggle('dark', t === 'dark'); localStorage.setItem('uasspain-theme', t); }, theme);
      await page.setViewportSize({ width, height: 1000 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`google-${theme}-${width}.png`), fullPage: true });
    }
    await page.getByLabel('Contraseña actual para verificar, vincular o desvincular').fill('E2eAdmin_2026!'); // pragma: allowlist secret - isolated fixture
    await page.getByRole('button', { name: 'Verificar con Google', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\?section=configuracion&tab=integraciones$/);
    await expect(form.getByText('Estado: VERIFIED_DISABLED', { exact: false })).toBeVisible();
    await expect(form.getByLabel('Habilitar acceso Google verificado')).toBeEnabled();
    await form.getByLabel('Habilitar acceso Google verificado').check(); await form.getByRole('button', { name: 'Guardar configuración Google' }).click(); await expect(form.getByText('Estado: ACTIVE', { exact: false })).toBeVisible();
    await page.getByLabel('Contraseña actual para verificar, vincular o desvincular').fill('E2eAdmin_2026!'); // pragma: allowlist secret - isolated fixture
    await page.getByRole('button', { name: 'Vincular cuenta Google', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\?section=configuracion&tab=integraciones$/); await expect(form.getByText('Vinculada a su cuenta UASSpain', { exact: false })).toBeVisible();
    await page.getByLabel('Contraseña actual para verificar, vincular o desvincular').fill('E2eAdmin_2026!'); // pragma: allowlist secret - isolated fixture
    await expect(page.getByRole('button', { name: 'Desvincular cuenta Google', exact: true })).toBeDisabled();
    await page.getByLabel('Escriba DESVINCULAR').fill('DESVINCULAR');
    await page.getByRole('button', { name: 'Desvincular cuenta Google', exact: true }).click(); await expect(page).toHaveURL(/auth=login/);
    await login(); await expect(form.getByText('Sin vincular', { exact: false })).toBeVisible();
    expect(sql("SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY key),'[]') FROM core_systemsetting s WHERE key IN ('smtp','mail_mode','mail_api','mail_api_draft')")).toBe(corporateMail);
    expect(errors).toEqual([]);
  } finally {
    for (const id of sql('SELECT id FROM google_oauth_flow').split('\n').filter(id => id && !beforeFlows.has(id))) sql(`DELETE FROM google_oauth_flow WHERE id=${q(id)}`);
    sql(`UPDATE accounts_userprofile SET google_subject_lookup=${beforeSubject ? q(beforeSubject) : 'NULL'} WHERE id=${q(actor)}`);
    sql("DELETE FROM core_systemsetting WHERE key='google_oauth'; DELETE FROM core_systemsecret WHERE key='google_oauth_client_secret'");
    sql(`INSERT INTO core_systemsetting SELECT * FROM jsonb_populate_recordset(NULL::core_systemsetting,${q(beforeSetting)}::jsonb); INSERT INTO core_systemsecret SELECT * FROM jsonb_populate_recordset(NULL::core_systemsecret,${q(beforeSecrets)}::jsonb)`);
    // Protected synthetic security evidence is deliberately retained.
  }
});
