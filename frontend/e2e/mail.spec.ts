import { expect, test } from '@playwright/test';
import { adminClient, sql, uuid } from '../../scripts/e2e/auth-fixtures.mjs';
import { randomUUID } from 'node:crypto';

// All writes target the isolated fixture database. No delivery/test endpoint is called.
test('exclusive mail radios preserve drafts, validate channel changes and persist both channels', async ({ page }, info) => {
  test.setTimeout(180000);
  expect(info.project.use.baseURL).toBe('https://localhost:8444');
  const admin = await adminClient(), quote = (v: string) => "'" + v.replaceAll("'", "''") + "'";
  const keys = ['mail_api', 'mail_api_draft', 'mail_mode', 'smtp'];
  const secretKeys = ['postmark_candidate', 'postmark_server_token', 'smtp_password'];
  const settings = sql(`SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]') FROM core_systemsetting s WHERE key IN (${keys.map(quote).join(',')})`);
  const secrets = sql(`SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]') FROM core_systemsecret s WHERE key IN (${secretKeys.map(quote).join(',')})`);
  const migrations = sql("SELECT COALESCE(jsonb_agg(to_jsonb(m)),'[]') FROM mail_migration m");
  const migrationId = JSON.parse(migrations)[0]?.id || randomUUID();
  const outbox = sql('SELECT count(*) FROM mail_outbox');
  expect(Number(sql("SELECT count(*) FROM mail_outbox WHERE state IN ('PENDING','RETRY_SCHEDULED','PROCESSING')"))).toBe(0);
  const set = (key, value) => sql(`INSERT INTO core_systemsetting(id,key,value,created_date,updated_date) VALUES('${randomUUID()}',${quote(key)},${quote(JSON.stringify(value))}::jsonb,NOW(),NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`);
  const form = page.getByRole('form', { name: 'Configuración API de correo', exact: true });
  const smtp = page.getByRole('form', { name: 'Configuración SMTP', exact: true });
  const apiRadio = form.getByRole('radio', { name: 'API — Postmark', exact: true });
  const smtpRadio = form.getByRole('radio', { name: 'SMTP', exact: true });
  const save = async (status = 200) => {
    const pending = page.waitForResponse(r => r.url().endsWith('/api/system/mail/') && r.request().method() === 'PUT');
    await form.getByRole('button', { name: 'Guardar canal y configuración', exact: true }).click();
    expect((await pending).status()).toBe(status);
    await expect(form.getByRole('button', { name: 'Guardar canal y configuración', exact: true })).toBeEnabled();
  };
  const reload = async () => { await page.reload(); await page.getByRole('button', { name: 'SMTP / Correo', exact: true }).click(); };
  const errors: string[] = [], deliveries: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (r.method() === 'POST' && /\/api\/system\/(mail|smtp)\/test\//.test(r.url())) deliveries.push(r.url()); });
  try {
    set('mail_mode', { api_exclusive: false });
    await page.goto('/?auth=login');
    await page.getByLabel('Correo electrónico *', { exact: true }).fill('e2e-admin@test.local');
    await page.getByLabel('Contraseña *', { exact: true }).fill(process.env.E2E_ADMIN_PASSWORD || 'E2eAdmin_2026!'); // pragma: allowlist secret - isolated fixture
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click(); await expect(page).toHaveURL(/\/admin$/);
    await page.goto('/admin?section=configuracion&tab=smtp');
    await page.getByRole('button', { name: 'SMTP / Correo', exact: true }).click();
    await expect(smtpRadio).toBeChecked();
    await expect(form.getByRole('group', { name: 'Canal de correo', exact: true }).getByRole('radio')).toHaveCount(2);
    await expect(page.getByRole('checkbox', { name: 'Utilizar API de correo exclusivamente', exact: true })).toHaveCount(0);
    await expect(smtp.getByRole('checkbox', { name: 'Habilitado', exact: true })).toHaveCount(0);
    await expect(form.getByLabel('API Key', { exact: true })).toBeDisabled();
    await apiRadio.check(); await expect(smtpRadio).not.toBeChecked();
    for (const input of await smtp.locator('input,select,button').all()) await expect(input).toBeDisabled();
    expect((await admin.call('/api/system/mail/')).body.api_exclusive).toBe(false);
    await form.getByLabel('API Key', { exact: true }).fill('isolated-mail-radio-fixture');
    await save(); await expect(apiRadio).toBeChecked();
    await expect(form).toContainText('SMTP sigue vigente');
    expect((await admin.call('/api/system/mail/')).body.api_exclusive).toBe(false);
    const ciphertext = sql("SELECT ciphertext FROM core_systemsecret WHERE key='postmark_candidate'");
    expect(ciphertext.startsWith('v1:')).toBe(true);
    await save(); expect(sql("SELECT ciphertext FROM core_systemsecret WHERE key='postmark_candidate'") === ciphertext).toBe(true);
    const draft = (await admin.call('/api/system/mail/')).body.config;
    expect((await admin.call('/api/system/mail/', 'PUT', { api_exclusive: true, config: draft, api_key: '' })).status).toBe(400);
    await reload(); await expect(smtpRadio).toBeChecked();
    for (const input of await form.getByRole('group', { name: 'Configuración API', exact: true }).locator('input,select,button').all()) await expect(input).toBeDisabled();
    await smtp.getByLabel('Servidor SMTP', { exact: true }).fill('smtp.radio-fixture.invalid');
    await smtp.getByLabel('Usuario SMTP', { exact: true }).fill('fixture@example.invalid');
    await smtp.getByLabel('Contraseña SMTP', { exact: true }).fill('isolated-smtp-radio-fixture');
    await smtp.getByLabel('Email remitente', { exact: true }).fill('fixture@example.invalid');
    const smtpSaved = page.waitForResponse(r => r.url().endsWith('/api/system/smtp/') && r.request().method() === 'PUT');
    await smtp.getByRole('button', { name: 'Guardar configuración', exact: true }).click(); expect((await smtpSaved).status()).toBe(200);
    await reload(); await expect(smtpRadio).toBeChecked();
    await expect(smtp.getByLabel('Servidor SMTP', { exact: true })).toHaveValue('smtp.radio-fixture.invalid');
    await expect(smtp.getByLabel('Contraseña SMTP', { exact: true })).toHaveValue('');
    expect((await admin.call('/api/system/smtp/')).body.enabled).toBe(true);
    // A synthetic previously verified sender tests policy persistence, not real Postmark delivery.
    const verified = { ...draft, sender_panel_confirmed: true, verified_at: new Date().toISOString(), verification_message_id: randomUUID() };
    set('mail_api', verified); set('mail_api_draft', verified);
    sql(`INSERT INTO core_systemsecret(id,key,ciphertext) SELECT '${randomUUID()}','postmark_server_token',ciphertext FROM core_systemsecret WHERE key='postmark_candidate' ON CONFLICT(key) DO UPDATE SET ciphertext=EXCLUDED.ciphertext`);
    sql("DELETE FROM core_systemsecret WHERE key='postmark_candidate'");
    if (JSON.parse(migrations).length) sql(`UPDATE mail_migration SET state='API_VERIFIED',last_passed='API_VERIFIED' WHERE id='${uuid(migrationId)}'`);
    else sql(`INSERT INTO mail_migration(id,attempt_id,state,last_passed) VALUES('${uuid(migrationId)}','${randomUUID()}','API_VERIFIED','API_VERIFIED')`);
    await reload(); await expect(smtpRadio).toBeChecked(); await apiRadio.check(); await save();
    expect((await admin.call('/api/system/mail/')).body.api_exclusive).toBe(true);
    await reload(); await expect(apiRadio).toBeChecked(); await smtpRadio.check();
    expect((await admin.call('/api/system/mail/')).body.api_exclusive).toBe(true);
    await save(400); await expect(apiRadio).toBeChecked();
    // Rollback still requires explicit authorization and successful SMTP evidence.
    sql("UPDATE core_systemsetting SET value=value||jsonb_build_object('last_test_ok',true,'last_test_at',NOW()) WHERE key='smtp'");
    await smtpRadio.check(); await form.getByLabel('Autorizo comprobar SMTP y realizar una reversión sin borrar mensajes ni credenciales.', { exact: true }).check(); await save();
    expect((await admin.call('/api/system/mail/')).body.api_exclusive).toBe(false);
    await reload(); await expect(smtpRadio).toBeChecked();
    for (const theme of ['light','dark']) for (const width of [320,768,1440]) {
      await page.setViewportSize({width,height:1000}); await page.evaluate(t => { localStorage.setItem('theme',t);window.dispatchEvent(new StorageEvent('storage',{key:'theme',newValue:t,storageArea:localStorage})); },theme);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await expect(form.getByRole('radio')).toHaveCount(2); await page.screenshot({path:info.outputPath(`mail-radios-${theme}-${width}.png`),fullPage:true});
    }
    expect(errors).toEqual([]); expect(deliveries).toEqual([]); expect(sql('SELECT count(*) FROM mail_outbox')).toBe(outbox);
  } finally {
    sql(`BEGIN; DELETE FROM core_systemsetting WHERE key IN (${keys.map(quote).join(',')}); INSERT INTO core_systemsetting SELECT * FROM jsonb_populate_recordset(NULL::core_systemsetting,${quote(settings)}::jsonb); DELETE FROM core_systemsecret WHERE key IN (${secretKeys.map(quote).join(',')}); INSERT INTO core_systemsecret SELECT * FROM jsonb_populate_recordset(NULL::core_systemsecret,${quote(secrets)}::jsonb); COMMIT;`);
    if (JSON.parse(migrations).length) for (const m of JSON.parse(migrations)) sql(`UPDATE mail_migration SET state=${quote(m.state)},last_passed=${quote(m.last_passed)},version=${m.version},updated_at=${quote(m.updated_at)}::timestamptz WHERE id='${uuid(m.id)}'`);
    else sql(`BEGIN; DELETE FROM mail_migration_transition WHERE migration_id='${uuid(migrationId)}'; DELETE FROM mail_migration WHERE id='${uuid(migrationId)}'; COMMIT;`);
    const canonical = rows => JSON.stringify(rows.sort((a, b) => a.key.localeCompare(b.key)));
    expect(canonical(JSON.parse(sql(`SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]') FROM core_systemsetting s WHERE key IN (${keys.map(quote).join(',')})`))) === canonical(JSON.parse(settings))).toBe(true);
    expect(canonical(JSON.parse(sql(`SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]') FROM core_systemsecret s WHERE key IN (${secretKeys.map(quote).join(',')})`))) === canonical(JSON.parse(secrets))).toBe(true);
    await admin.call('/api/auth/logout/', 'POST', {});
  }
});
