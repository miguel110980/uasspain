import { expect, test } from '@playwright/test';
import { adminClient, apiClient, sql } from '../../scripts/e2e/auth-fixtures.mjs';
import { randomUUID } from 'node:crypto';

// Intended for an explicitly isolated rebuilt test stack, never the main instance.
test('SMTP-only configuration validates locally, saves identity and preserves encrypted secrets',async({page},info)=>{
  test.setTimeout(180000);expect(info.project.use.baseURL).toBe('https://localhost:8444');
  const admin=await adminClient(),quote=(v:string)=>"'"+v.replaceAll("'","''")+"'";
  const keys=['smtp','smtp_draft','mail_mode','smtp_service_contact','smtp_service_automatic'],secretKeys=['smtp_password','smtp_password_candidate','smtp_contact_password','smtp_contact_password_candidate','smtp_automatic_password','smtp_automatic_password_candidate'];
  const settings=sql(`SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]') FROM core_systemsetting s WHERE key IN (${keys.map(quote)})`),secrets=sql(`SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]') FROM core_systemsecret s WHERE key IN (${secretKeys.map(quote)})`);
  const protectedSettings=sql("SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY key),'[]') FROM core_systemsetting s WHERE key IN ('mail_api','mail_api_draft')"),protectedSecrets=sql("SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY key),'[]') FROM core_systemsecret s WHERE key LIKE 'postmark%'");
  const count=sql('SELECT count(*) FROM mail_outbox');expect(sql("SELECT count(*) FROM mail_outbox WHERE state IN ('PENDING','RETRY_SCHEDULED','PROCESSING')")).toBe('0');
  const errors:string[]=[],deliveries:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&/\/api\/system\/.*\/test\//.test(r.url()))deliveries.push(r.url());});
  const shared=page.getByRole('form',{name:'Configuración SMTP',exact:true});const reload=async()=>{await page.reload();await page.getByRole('button',{name:'SMTP / Correo',exact:true}).click();};
  const config={enabled:true,host:'smtp.fixture.invalid',port:587,security:'STARTTLS',username:'fixture@example.invalid',password:'isolated-smtp-persistence-fixture',from_email:'info@uasspain.com',from_name:'UASSpain',contact_recipient:'info@uasspain.com',timeout_seconds:12};
  try{
    sql(`DELETE FROM core_systemsetting WHERE key IN (${keys.map(quote)});DELETE FROM core_systemsecret WHERE key IN (${secretKeys.map(quote)});INSERT INTO core_systemsetting(id,key,value,created_date,updated_date) VALUES('${randomUUID()}','mail_mode','{"api_exclusive":false}',NOW(),NOW());`);
    await page.goto('/?auth=login');await page.locator('#login-email').fill('e2e-admin@test.local');await page.locator('#login-password').fill(process.env.E2E_ADMIN_PASSWORD||'E2eAdmin_2026!'); // pragma: allowlist secret - isolated fixture
    await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();await expect(page).toHaveURL(/\/admin$/);await page.goto('/admin?section=configuracion');await page.getByRole('button',{name:'SMTP / Correo',exact:true}).click();
    await expect(page.getByRole('radio',{name:/API|SMTP/})).toHaveCount(0);await expect(page.getByLabel('API Key',{exact:true})).toHaveCount(0);
    for(const[label,value]of[['Servidor SMTP',config.host],['Usuario SMTP',config.username],['Contraseña SMTP',config.password],['Puerto',String(config.port)],['Timeout (segundos)',String(config.timeout_seconds)]]){const input=shared.getByLabel(label,{exact:true});await expect(input).toBeEditable();await input.fill(value);}
    await shared.getByRole('combobox').selectOption('STARTTLS');
    const validation=page.waitForResponse(r=>r.url().endsWith('/api/system/smtp/validate/')&&r.request().method()==='POST');await shared.getByRole('button',{name:'Validar configuración sin enviar',exact:true}).click();expect((await validation).status()).toBe(200);expect(sql("SELECT count(*) FROM core_systemsetting WHERE key='smtp'")).toBe('0');expect(sql('SELECT count(*) FROM mail_outbox')).toBe(count);
    const saved=page.waitForResponse(r=>r.url().endsWith('/api/system/smtp/')&&r.request().method()==='PUT');await shared.getByRole('button',{name:'Guardar configuración',exact:true}).click();const response=await saved;expect(response.status()).toBe(200);const data=await response.json();expect(data.password).toBeUndefined();expect(data.ciphertext).toBeUndefined();
    const ciphertext=sql("SELECT ciphertext FROM core_systemsecret WHERE key='smtp_password'");expect(ciphertext.startsWith('v1:')).toBe(true);expect(ciphertext).not.toContain(config.password);await reload();await expect(shared.getByLabel('Servidor SMTP',{exact:true})).toHaveValue(config.host);await expect(shared.getByLabel('Contraseña SMTP',{exact:true})).toHaveValue('');
    for(const[service,title,address]of[['contact','Correo bidireccional','info@uasspain.com'],['automatic','Correo automático','no-reply@uasspain.com']]){
      const form=page.getByRole('form',{name:title,exact:true});await expect(form.getByLabel('Remitente',{exact:true})).toHaveValue(address);await expect(form.getByLabel('Remitente',{exact:true})).not.toBeEditable();await form.getByLabel('Habilitar este servicio',{exact:true}).check();
      await form.getByLabel('He confirmado en el proveedor que este remitente exacto está autorizado.',{exact:true}).check();const pending=page.waitForResponse(r=>r.url().endsWith(`/api/system/smtp/services/${service}/`)&&r.request().method()==='PUT');await form.getByRole('button',{name:'Guardar configuración',exact:true}).click();expect((await pending).status()).toBe(200);expect((await admin.call(`/api/system/smtp/services/${service}/`)).body.active_ready).toBe(false);await expect(form.getByRole('button',{name:'Enviar correo de prueba',exact:true})).toBeDisabled();
    }
    await reload();await expect(page.getByRole('form',{name:'Correo automático',exact:true}).getByLabel('Remitente',{exact:true})).toHaveValue('no-reply@uasspain.com');expect(sql("SELECT ciphertext FROM core_systemsecret WHERE key='smtp_password'")===ciphertext).toBe(true);
    expect((await apiClient().call('/api/system/smtp/services/contact/')).status).toBe(401);expect((await admin.call('/api/system/smtp/validate/','POST',{...config,security:'NONE'})).status).toBe(400);expect((await admin.call('/api/system/smtp/validate/','POST',{...config,from_email:'a@example.invalid\r\nBcc:b@example.invalid'})).status).toBe(400);
    sql("UPDATE core_systemsetting SET value=jsonb_build_object('api_exclusive',true) WHERE key='mail_mode'");await reload();await expect(shared.getByRole('button',{name:'Guardar configuración',exact:true})).toBeDisabled();expect((await admin.call('/api/system/smtp/','PUT',config)).status).toBe(400);expect((await admin.call('/api/system/mail/')).body.api_exclusive).toBe(true);
    for(const theme of ['light','dark'])for(const width of [320,768,1440]){await page.setViewportSize({width,height:1000});await page.evaluate(t=>{localStorage.setItem('theme',t);window.dispatchEvent(new StorageEvent('storage',{key:'theme',newValue:t,storageArea:localStorage}));},theme);await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
    expect(errors).toEqual([]);expect(deliveries).toEqual([]);expect(sql('SELECT count(*) FROM mail_outbox')).toBe(count);
  }finally{
    sql(`BEGIN;DELETE FROM core_systemsetting WHERE key IN (${keys.map(quote)});INSERT INTO core_systemsetting SELECT * FROM jsonb_populate_recordset(NULL::core_systemsetting,${quote(settings)}::jsonb);DELETE FROM core_systemsecret WHERE key IN (${secretKeys.map(quote)});INSERT INTO core_systemsecret SELECT * FROM jsonb_populate_recordset(NULL::core_systemsecret,${quote(secrets)}::jsonb);COMMIT;`);
    expect(sql("SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY key),'[]') FROM core_systemsetting s WHERE key IN ('mail_api','mail_api_draft')")).toBe(protectedSettings);expect(sql("SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY key),'[]') FROM core_systemsecret s WHERE key LIKE 'postmark%'")).toBe(protectedSecrets);await admin.call('/api/auth/logout/','POST',{});
  }
});

test('persistent history visibility survives real Docker sessions and permits new backend events', async ({page},info)=>{
  test.setTimeout(180000);expect(info.project.use.baseURL).toBe('https://localhost:8444');
  const {createCipheriv,randomBytes}=await import('node:crypto');
  const key=Buffer.from(process.env.E2E_FIELD_ENCRYPTION_KEY!,'base64');expect(key.length).toBe(32);
  const ids=[randomUUID(),randomUUID()],existing=sql('SELECT count(*) FROM mail_outbox'),kind='smtp_history_fixture';
  const add=(id:string)=>{const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce),payload='v1:'+Buffer.concat([nonce,cipher.update(JSON.stringify({from:'fixture@example.invalid',from_name:'SMTP fixture',to:'fixture@example.invalid',reply_to:null,subject:'History fixture',body:'Synthetic local history event',smtp:null})),cipher.final(),cipher.getAuthTag()]).toString('base64url');sql(`INSERT INTO mail_outbox(id,message_type,provider,payload_ciphertext,idempotency_key,state,expires_at,last_error) VALUES('${id}','${kind}','smtp','${payload}','history-${id}','FAILED',NOW()+INTERVAL '1 hour','synthetic_fixture')`);};
  const open=async()=>{await page.goto('/admin?section=configuracion');await page.getByRole('button',{name:'SMTP / Correo',exact:true}).click();};
  const login=async()=>{await page.goto('/?auth=login');await page.locator('#login-email').fill('e2e-admin@test.local');await page.locator('#login-password').fill(process.env.E2E_ADMIN_PASSWORD||'E2eAdmin_2026!');await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();await expect(page).toHaveURL(/\/admin$/);}; // pragma: allowlist secret - isolated fixture
  const rows=page.getByRole('table').locator('tbody tr');
  const refresh=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/system/mail/monitor/'));await page.getByRole('button',{name:'Actualizar correo',exact:true}).click();expect((await response).status()).toBe(200);await expect(page.getByRole('button',{name:'Actualizar correo',exact:true})).toBeEnabled();};
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    add(ids[0]);await login();await open();await expect(rows.filter({hasText:ids[0]})).toHaveCount(1);
    const before=sql('SELECT count(*) FROM mail_outbox');
    page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Limpiar historial',exact:true}).click();await expect(rows).toHaveCount(0);
    await refresh();await expect(rows).toHaveCount(0);
    await page.reload();await page.getByRole('button',{name:'SMTP / Correo',exact:true}).click();await refresh();await expect(rows).toHaveCount(0);
    await page.getByRole('button',{name:'Configuración general',exact:true}).click();await page.getByRole('button',{name:'SMTP / Correo',exact:true}).click();await refresh();await expect(rows).toHaveCount(0);
    await page.getByRole('button',{name:'Menú de cuenta',exact:true}).click();await page.getByRole('button',{name:'Cerrar sesión',exact:true}).click();await expect(page).toHaveURL('/');
    await login();await open();await refresh();await expect(rows).toHaveCount(0);expect(sql('SELECT count(*) FROM mail_outbox')).toBe(before);
    add(ids[1]);await refresh();await expect(rows).toHaveCount(1);await expect(rows).toContainText(ids[1]);
    expect(sql(`SELECT count(*) FROM mail_outbox WHERE id IN ('${ids[0]}','${ids[1]}') AND state='FAILED'`)).toBe('2');expect(errors).toEqual([]);
  }finally{
    sql(`DELETE FROM mail_outbox WHERE id IN ('${ids[0]}','${ids[1]}') AND message_type='${kind}' AND state='FAILED'`);expect(sql('SELECT count(*) FROM mail_outbox')).toBe(existing);key.fill(0);
  }
});
