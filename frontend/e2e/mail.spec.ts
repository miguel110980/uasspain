import { expect, test } from '@playwright/test';
import { sql, uuid } from '../../scripts/e2e/auth-fixtures.mjs';

test('mail configuration preserves SMTP and refuses an unverified API sender', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  expect(['https://localhost:8444', 'https://localhost:18444', 'http://127.0.0.1:8011']).toContain(testInfo.project.use.baseURL);
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const keys = ['mail_api', 'mail_api_draft', 'mail_mode'];
  const settings = JSON.parse(sql(`SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]'::jsonb) FROM core_systemsetting s WHERE key IN (${keys.map(quote).join(',')})`));
  const secrets = JSON.parse(sql("SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]'::jsonb) FROM core_systemsecret s WHERE key='postmark_candidate'"));
  const smtp = sql("SELECT COALESCE((SELECT value::text FROM core_systemsetting WHERE key='smtp'),'null')");
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('/?auth=login');
    await page.getByLabel('Correo electrónico *', { exact: true }).fill('e2e-admin@test.local');
    await page.getByLabel('Contraseña *', { exact: true }).fill('E2eAdmin_2026!'); // pragma: allowlist secret - isolated fixture
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.locator('aside:visible nav').getByRole('button', { name: 'Configuración', exact: true }).click();
    await page.getByRole('button', { name: 'SMTP / Correo', exact: true }).click();
    const api = page.getByRole('form', { name: 'Configuración API de correo', exact: true });
    const legacy = page.getByRole('form', { name: 'Configuración SMTP', exact: true });
    await expect(api.getByRole('button', { name: 'Guardar configuración API', exact: true })).toBeEnabled();
    await expect(api.getByLabel('Email remitente API', { exact: true })).toHaveValue('no-reply@uasspain.com');
    await api.getByLabel('API Key', { exact: true }).fill('isolated-mail-browser-fixture');
    const saved = page.waitForResponse(response => response.url().endsWith('/api/system/mail/') && response.request().method() === 'PUT');
    await api.getByRole('button', { name: 'Guardar configuración API', exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(api.getByLabel('API Key', { exact: true })).toHaveValue('');
    await expect(api.getByRole('status')).toContainText('Configuración guardada');
    await expect(api).toContainText('Sin confirmar');
    await api.getByLabel('Utilizar API de correo exclusivamente').check();
    await expect(legacy.getByLabel('Servidor SMTP', { exact: true })).toBeDisabled();
    await expect(legacy.getByLabel('Contraseña SMTP', { exact: true })).toBeDisabled();
    await expect(api.getByLabel('Email remitente API', { exact: true })).toHaveAttribute('readonly');
    await expect(api).toContainText('Cambio de canal sin guardar');
    await expect(api).toContainText('Sigue vigente SMTP');
    const denied = page.waitForResponse(response => response.url().endsWith('/api/system/mail/') && response.request().method() === 'PUT');
    await api.getByRole('button', { name: 'Guardar configuración API', exact: true }).click();
    expect((await denied).status()).toBe(400);
    await expect(api.getByRole('status')).toContainText('verifique credenciales y remitente');
    await expect(api.getByLabel('Utilizar API de correo exclusivamente')).not.toBeChecked();
    await expect(legacy.getByLabel('Servidor SMTP', { exact: true })).toBeEnabled();
    await page.reload();
    await page.locator('aside:visible nav').getByRole('button', { name: 'Configuración', exact: true }).click();
    await page.getByRole('button', { name: 'SMTP / Correo', exact: true }).click();
    await expect(api.getByLabel('API Key', { exact: true })).toHaveValue('');
    await expect(api.getByLabel('Utilizar API de correo exclusivamente')).not.toBeChecked();
    await expect(page.getByRole('region', { name: 'Monitorización de correo', exact: true })).toBeVisible();
    for (const theme of ['light', 'dark']) for (const width of [320, 375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(value => { document.documentElement.classList.toggle('dark', value === 'dark'); document.documentElement.classList.toggle('light', value === 'light'); }, theme);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await expect(api.getByLabel('API Key', { exact: true })).toHaveValue('');
      const rows = page.getByRole('region', { name: 'Monitorización de correo', exact: true }).locator('tbody tr');
      expect(await rows.evaluateAll(elements => elements.every(element => element.getBoundingClientRect().height < 120))).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`mail-${theme}-${width}.png`), fullPage: true });
    }
    expect(errors).toEqual([]);
    expect(sql("SELECT COALESCE((SELECT value::text FROM core_systemsetting WHERE key='smtp'),'null')")).toBe(smtp);
  } finally {
    for (const name of keys) { const id = sql(`SELECT id FROM core_systemsetting WHERE key=${quote(name)}`); if (id) sql(`DELETE FROM core_systemsetting WHERE id='${uuid(id)}' AND key=${quote(name)}`); }
    if (settings.length) sql(`INSERT INTO core_systemsetting SELECT * FROM jsonb_populate_recordset(NULL::core_systemsetting,${quote(JSON.stringify(settings))}::jsonb)`);
    const secretId = sql("SELECT id FROM core_systemsecret WHERE key='postmark_candidate'");
    if (secretId) sql(`DELETE FROM core_systemsecret WHERE id='${uuid(secretId)}' AND key='postmark_candidate'`);
    if (secrets.length) sql(`INSERT INTO core_systemsecret SELECT * FROM jsonb_populate_recordset(NULL::core_systemsecret,${quote(JSON.stringify(secrets))}::jsonb)`);
  }
});
