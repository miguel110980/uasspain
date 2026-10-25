import { expect, test } from '@playwright/test';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { sql, uuid } from '../../scripts/e2e/auth-fixtures.mjs';

for (const [state, text] of [
  ['PENDING', 'Consulta registrada y pendiente de envío.'],
  ['UNKNOWN', 'Estamos comprobando el envío'],
  ['ACCEPTED', 'Consulta aceptada para su envío.'],
  ['DELIVERED', 'Consulta entregada al servidor de correo según el proveedor.'],
  ['FAILED', 'La consulta no se ha enviado.'],
] as const) {
  test(`contact UI preserves ${state} and submits once`, async ({ page }, testInfo) => {
    expect(['https://localhost:18444', 'https://localhost:8444']).toContain(testInfo.project.use.baseURL);
    let requests = 0;
    await page.route('**/api/contact/', async route => {
      requests++;
      const input = route.request().postDataJSON();
      expect(input.email).toBe('visitor@example.invalid');
      expect(input.request_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(input.mensaje).toBe('Consulta sintética\nSegunda línea');
      await new Promise(resolve => setTimeout(resolve, 200));
      const failed = state === 'FAILED';
      await route.fulfill({ status: failed ? 503 : 200, contentType: 'application/json', body: JSON.stringify({
        state, internally_accepted: !failed, delivery_accepted: ['ACCEPTED','DELIVERED'].includes(state),
        delivery_confirmed: state === 'DELIVERED', detail: failed ? text : '',
      }) });
    });
    await page.goto('/contacto');
    await page.locator('#contactsection-field-1').fill('Visitante de prueba');
    await page.locator('#contactsection-field-3').fill('visitor@example.invalid');
    await page.locator('#contactsection-subject').fill('Consulta sintética');
    await page.locator('#contactsection-field-5').click();
    await page.getByRole('option', { name: 'Otro', exact: true }).click();
    await page.locator('#contactsection-field-6').fill('Consulta sintética\nSegunda línea');
    await page.getByRole('button', { name: 'Enviar Mensaje', exact: true }).evaluate(button => { button.click(); button.click(); });
    const form = page.locator('#contacto form');
    await expect(form.getByRole(state === 'FAILED' ? 'alert' : 'status')).toContainText(text);
    if (state === 'FAILED') await expect(form.getByRole('status')).toHaveCount(0);
    expect(requests).toBe(1);
  });
}

test('contact traverses Docker HTTPS and the real API without sending externally', async ({ page }, testInfo) => {
  expect(['https://localhost:18444', 'https://localhost:8444']).toContain(testInfo.project.use.baseURL);
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const settingKeys = ['smtp', 'mail_mode', 'smtp_service_contact'];
  const settings = JSON.parse(sql("SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]') FROM core_systemsetting s WHERE key IN ('smtp','mail_mode','smtp_service_contact')"));
  const secrets = JSON.parse(sql("SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]') FROM core_systemsecret s WHERE key='smtp_password'"));
  const circuits = JSON.parse(sql("SELECT to_jsonb(c) FROM mail_circuit c WHERE provider='smtp'"));
  const key = Buffer.from(process.env.E2E_FIELD_ENCRYPTION_KEY!, 'base64');
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
  const encrypted = 'v1:' + Buffer.concat([nonce, cipher.update('isolated-never-used-smtp-password'), cipher.final(), cipher.getAuthTag()]).toString('base64').replaceAll('+','-').replaceAll('/','_');
  const set = (name: string, value: object) => sql(`INSERT INTO core_systemsetting(id,created_date,updated_date,key,value) VALUES('${randomUUID()}',NOW(),NOW(),${quote(name)},${quote(JSON.stringify(value))}::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`);
  let id: string | undefined;
  const visitor = `browser-contact-${randomUUID()}@example.invalid`;
  try {
    // SMTP identities, exclusively in the isolated project. An
    // OPEN circuit prevents this fixture from making any provider request.
    sql("UPDATE mail_circuit SET state='OPEN',opened_at=NOW()+INTERVAL '1 day' WHERE provider='smtp'");
    const config = {enabled:true,provider:'',host:'smtp.fixture.invalid',port:587,security:'STARTTLS',username:'fixture@example.invalid',from_email:'info@uasspain.com',from_name:'UASSpain',contact_recipient:'info@uasspain.com',timeout_seconds:2,last_test_ok:null,last_test_at:null};
    set('smtp',config);
    // Synthetic policy evidence only. The circuit remains OPEN and no delivery
    // is attempted; real sender acceptance is covered by the isolated TLS suite.
    const blindKey=createHash('sha256').update(key).update('|blind-index|v1').digest();
    const fingerprint=createHmac('sha256',blindKey).update(JSON.stringify(['contact',true,true,true,false,config,'isolated-never-used-smtp-password'])).digest('hex');blindKey.fill(0);
    set('smtp_service_contact',{active:{enabled:true,shared_transport:true,authorized_sender:true,independent_auth_required:false,config:null},draft:null,proofs:[{fingerprint,at:new Date().toISOString(),accepted:true,message_id:randomUUID()}]});
    set('mail_mode', { api_exclusive:false });
    sql(`INSERT INTO core_systemsecret(id,key,ciphertext) VALUES('${randomUUID()}','smtp_password',${quote(encrypted)}) ON CONFLICT(key) DO UPDATE SET ciphertext=EXCLUDED.ciphertext`);
    await page.goto('/contacto');
    await page.locator('#contactsection-field-1').fill('Visitante de prueba');
    await page.locator('#contactsection-field-2').fill('Empresa de prueba');
    await page.locator('#contactsection-field-3').fill(visitor);
    await page.locator('#contactsection-field-4').fill('+34 600 000 000');
    await page.locator('#contactsection-subject').fill('Consulta por HTTPS');
    await page.locator('#contactsection-field-5').click();
    await page.getByRole('option', { name:'Otro', exact:true }).click();
    await page.locator('#contactsection-field-6').fill('Consulta sintética del navegador');
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/contact/') && response.request().method() === 'POST');
    await page.getByRole('button', { name:'Enviar Mensaje', exact:true }).evaluate(button => { button.click(); button.click(); });
    const response = await responsePromise;
    const result = await response.json();
    id = result.message_id ? uuid(result.message_id) : undefined;
    expect(response.status()).toBe(200);
    expect(result.state).toBe('PENDING');
    expect(result.delivery_accepted).toBe(false);
    expect(result.delivery_confirmed).toBe(false);
    await expect(page.locator('#contacto form').getByRole('status')).toContainText('Consulta registrada y pendiente de envío.');
    expect(sql(`SELECT provider='smtp' AND attempts=0 FROM mail_outbox WHERE id='${id}'`)).toBe('t');
    const bytes = Buffer.from(sql(`SELECT payload_ciphertext FROM mail_outbox WHERE id='${id}'`).slice(3), 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0,12));
    decipher.setAuthTag(bytes.subarray(-16));
    const message = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12,-16)), decipher.final()]).toString());
    expect(message).toMatchObject({ from:'info@uasspain.com', from_name:'UASSpain', to:'info@uasspain.com', reply_to:visitor, subject:'Consulta por HTTPS', smtp:{host:'smtp.fixture.invalid'} });
    for (const value of ['Visitante de prueba', 'Empresa de prueba', visitor, '+34 600 000 000', 'Otro', 'Consulta por HTTPS', 'Consulta sintética del navegador']) expect(message.body).toContain(value);
  } finally {
    if (id) sql(`DELETE FROM mail_outbox WHERE id='${uuid(id)}' AND state='PENDING' AND message_type='contact'`);
    for (const name of settingKeys) sql(`DELETE FROM core_systemsetting WHERE key=${quote(name)}`);
    if (settings.length) sql(`INSERT INTO core_systemsetting SELECT * FROM jsonb_populate_recordset(NULL::core_systemsetting,${quote(JSON.stringify(settings))}::jsonb)`);
    sql("DELETE FROM core_systemsecret WHERE key='smtp_password'");
    if (secrets.length) sql(`INSERT INTO core_systemsecret SELECT * FROM jsonb_populate_recordset(NULL::core_systemsecret,${quote(JSON.stringify(secrets))}::jsonb)`);
    sql(`UPDATE mail_circuit SET state=${quote(circuits.state)},failures=${circuits.failures},opened_at=${circuits.opened_at ? quote(circuits.opened_at)+'::timestamptz' : 'NULL'} WHERE provider='smtp'`);
    key.fill(0);
  }
});
