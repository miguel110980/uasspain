import { expect, test, type Page } from '@playwright/test';
import fixture from '../scripts/ui-fixtures.mjs';
import AxeBuilder from '@axe-core/playwright';

// Every API/WebSocket is intercepted: no production account, queue or SMTP is used.
async function mailFixture(page: Page, pendingSmtp = false) {
  const profile=fixture.profiles.find(p=>p.role==='admin');
  const config={enabled:true,provider:'preserved-legacy-label',host:'saved-smtp.example.invalid',port:587,security:'STARTTLS',username:'fixture@example.invalid',from_email:'info@uasspain.com',from_name:'UASSpain',contact_recipient:'info@uasspain.com',timeout_seconds:30};
  const make=(service:'contact'|'automatic')=>{const address=service==='contact'?'info@uasspain.com':'no-reply@uasspain.com';const c={...config,from_email:address};return {address,config:c,settings:{enabled:true,shared_transport:service==='automatic',authorized_sender:true,independent_auth_required:service==='contact',config:service==='contact'?c:null},revision:`saved-${service}`,configured:true,validated:true,password_configured:true,verification_status:'BLOCKED_PENDING_AUTHORIZED_TEST',active_ready:false,pending_verification:service==='contact'&&pendingSmtp,ready_to_activate:false,api_mode_blocked:false};};
  const state={calls:[] as {path:string;method:string;payload?:Record<string,unknown>}[],smtp:config,services:{contact:make('contact'),automatic:make('automatic')},messages:[{id:'10000000-0000-4000-8000-000000000001',message_type:'provider_test',provider:'smtp',state:'FAILED',attempts:1,created_at:'2026-10-25T10:00:00Z',last_error:'smtp_authentication_failed',provider_latency_ms:42}],monitorReads:0,delayNext:false,release:null as null|(()=>Promise<void>),loggedIn:true,testStatus:200,testState:'FAILED',apiBlocked:false};
  await page.context().routeWebSocket('**/ws/**',socket=>socket.onMessage(()=>{}));
  await page.route(url=>url.pathname.startsWith('/api/'),async route=>{
    const request=route.request(),path=new URL(request.url()).pathname,method=request.method(),payload=method==='GET'?undefined:request.postDataJSON();state.calls.push({path,method,payload});
    if(path==='/api/auth/me/')return route.fulfill({status:state.loggedIn?200:401,json:state.loggedIn?{...profile,session_role:'admin',profile}:{detail:'Sin sesión.'}});
    if(path==='/api/auth/logout/'){state.loggedIn=false;return route.fulfill({json:{ok:true}});}if(path==='/api/auth/login/'){state.loggedIn=true;return route.fulfill({json:{ok:true}});}
    if(path==='/api/system/status/')return route.fulfill({json:{...fixture.status,mail:{provider:'smtp',channel_ready:false,api_mode_blocked:state.apiBlocked,services:state.services}}});
    if(path==='/api/profiles/')return route.fulfill({json:fixture.profiles});
    if(path==='/api/system/mail/monitor/'){
      state.monitorReads++;const response={channel:'smtp',counts:{FAILED:17,PENDING:3},alerts:[],circuits:[{provider:'smtp',state:'CLOSED',failures:0}],messages:[...state.messages],observed_at:'2026-10-25T10:01:00Z'};
      if(state.delayNext){state.delayNext=false;await new Promise<void>(resolve=>{state.release=async()=>{await route.fulfill({json:response});resolve();};});return;}return route.fulfill({json:response});
    }
    if(path==='/api/system/smtp/') {if(method==='PUT')state.smtp={...state.smtp,...payload,password:undefined};return route.fulfill({json:{...state.smtp,password_configured:true,configured:true,api_mode_blocked:state.apiBlocked}});}
    if(path==='/api/system/smtp/validate/')return route.fulfill({json:{valid:true,detail:'Formato válido, sin conexión ni envío.'}});
    const service=path.includes('/services/contact/')?'contact':path.includes('/services/automatic/')?'automatic':null;
    if(service){const view=state.services[service];
      if(path.endsWith('/validate/'))return route.fulfill({json:{valid:true,detail:'Formato válido, sin conexión ni envío.'}});
      if(path.endsWith('/test/')){if(state.testStatus===200){view.ready_to_activate=true;view.verification_status='ACCEPTED';}else{view.verification_status=state.testState;}return route.fulfill({status:state.testStatus,json:{state:state.testStatus===200?'ACCEPTED':'FAILED',detail:state.testStatus===200?'Prueba SMTP simulada aceptada.':'No se pudo autenticar en SMTP.'}});}
      if(method==='PUT'){view.settings=payload.settings;view.config=payload.settings.config||{...state.smtp,from_email:view.address};view.revision+='-saved';if(view.ready_to_activate)view.pending_verification=false;}
      return route.fulfill({json:{...view,api_mode_blocked:state.apiBlocked}});
    }
    return route.fulfill({json:method==='GET'?[]:{ok:true}});
  });
  await page.goto('/admin?section=configuracion');await page.getByRole('button',{name:'SMTP / Correo',exact:true}).click();
  const smtp=page.getByRole('form',{name:'Correo bidireccional',exact:true});await expect(smtp.getByLabel('Servidor SMTP',{exact:true})).toHaveValue(config.host);return{state,smtp};
}
const sendName='Enviar correo de prueba';
const consent='Autorizo expresamente una prueba de este servicio a este destinatario.';
async function confirmClear(page:Page){page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Limpiar historial',exact:true}).click();}

test('only SMTP remains, fixed identities are separated and independent values persist without exposing passwords',async({page})=>{
  const{state,smtp}=await mailFixture(page);await expect(page.getByRole('radio')).toHaveCount(0);await expect(page.getByRole('form',{name:'Configuración API de correo'})).toHaveCount(0);
  for(const label of ['Servidor SMTP','Puerto','Usuario SMTP','Contraseña SMTP','Timeout (segundos)'])await expect(smtp.getByLabel(label,{exact:true})).toBeEditable();
  await smtp.getByRole('combobox').last().selectOption('TLS');await expect(smtp.getByRole('combobox').last()).toHaveValue('TLS');
  await expect(smtp.getByLabel('Remitente',{exact:true})).toHaveValue('info@uasspain.com');await expect(smtp.getByLabel('Remitente',{exact:true})).not.toBeEditable();
  await expect(page.getByRole('form',{name:'Correo automático',exact:true}).getByLabel('Remitente',{exact:true})).toHaveValue('no-reply@uasspain.com');
  await smtp.getByLabel('Usuario SMTP',{exact:true}).fill('changed@example.invalid');await smtp.getByRole('button',{name:'Guardar configuración',exact:true}).click();await expect(smtp.getByRole('status').last()).toContainText('Configuración guardada.');
  await page.reload();await page.getByRole('button',{name:'SMTP / Correo',exact:true}).click();await expect(smtp.getByLabel('Usuario SMTP',{exact:true})).toHaveValue('changed@example.invalid');await expect(smtp.getByLabel('Contraseña SMTP',{exact:true})).toHaveValue('');
  expect(state.calls.find(c=>c.method==='PUT')?.payload?.password).toBe('');expect(state.calls.filter(c=>c.path==='/api/system/mail/'||c.path==='/api/system/mail/test/')).toEqual([]);
});
test('validation checks the edited draft without saving or authorizing delivery',async({page})=>{
  const{state,smtp}=await mailFixture(page);await smtp.getByLabel('Servidor SMTP',{exact:true}).fill('edited.example.invalid');await smtp.getByRole('button',{name:'Validar sin enviar',exact:true}).click();await expect(smtp.getByRole('status').last()).toHaveText('Formato válido, sin conexión ni envío.');
  expect(state.calls.filter(c=>c.method!=='GET'&&c.path.startsWith('/api/system/'))).toEqual([{path:'/api/system/smtp/services/contact/validate/',method:'POST',payload:expect.objectContaining({settings:expect.objectContaining({config:expect.objectContaining({host:'edited.example.invalid'})}),password:''})}]);await expect(smtp.getByRole('button',{name:sendName,exact:true})).toBeDisabled();
});
test('SMTP test requires saved changes and explicit recipient consent, errors never select another transport',async({page})=>{
  const{state,smtp}=await mailFixture(page);const send=smtp.getByRole('button',{name:sendName,exact:true});await smtp.getByLabel('Destinatario de prueba',{exact:true}).fill('authorized@example.invalid');await expect(send).toBeDisabled();await smtp.getByLabel(consent,{exact:true}).check();await expect(send).toBeEnabled();
  await smtp.getByLabel('Usuario SMTP',{exact:true}).fill('changed@example.invalid');await expect(send).toBeDisabled();await expect(smtp.getByLabel(consent,{exact:true})).not.toBeChecked();await smtp.getByRole('button',{name:'Guardar configuración',exact:true}).click();await expect(send).toBeDisabled();await smtp.getByLabel(consent,{exact:true}).check();state.testStatus=503;await send.click();await expect(smtp.getByRole('status').last()).toHaveText('No se pudo autenticar en SMTP.');
  expect(state.calls.filter(c=>c.path.endsWith('/test/'))).toEqual([{path:'/api/system/smtp/services/contact/test/',method:'POST',payload:{recipient:'authorized@example.invalid',revision:state.services.contact.revision,confirm_authorized_recipient:true,request_id:expect.stringMatching(/^[0-9a-f-]{36}$/)}}]);await expect(smtp.getByLabel(consent,{exact:true})).not.toBeChecked();
});
test('SMTP draft keeps the working transport until authorized test and another save',async({page})=>{
  const{state,smtp}=await mailFixture(page,true);await expect(smtp).toContainText('El servicio activo se conserva.');await smtp.getByRole('button',{name:'Guardar configuración',exact:true}).click();await expect(smtp.getByRole('status').last()).toContainText('Borrador guardado.');await smtp.getByLabel('Destinatario de prueba',{exact:true}).fill('authorized@example.invalid');await smtp.getByLabel(consent,{exact:true}).check();await smtp.getByRole('button',{name:sendName,exact:true}).click();await expect(smtp).toContainText('Prueba vigente; vuelva a guardar para aplicar.');expect(state.services.contact.pending_verification).toBe(true);await smtp.getByRole('button',{name:'Guardar configuración',exact:true}).click();await expect(smtp.getByRole('status').last()).toContainText('Configuración guardada.');expect(state.services.contact.pending_verification).toBe(false);
});

test('history clear persists after refresh, reload, navigation and logout/login while later events appear', async ({ page }) => {
  const { state } = await mailFixture(page);
  const rows = page.getByRole('table').locator('tbody tr');
  await expect(rows).toHaveCount(1);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Limpiar historial', exact: true }).click();
  await expect(rows).toHaveCount(1);
  const original = JSON.stringify(state.messages);
  await confirmClear(page);
  await expect(rows).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Monitorización de correo' })).toContainText('Fallidos: 17');
  await page.getByRole('button', { name: 'Actualizar correo', exact: true }).click();
  await expect(rows).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'SMTP / Correo', exact: true }).click();
  await expect(rows).toHaveCount(0);
  await page.getByRole('button', { name: 'Configuración general', exact: true }).click();
  await page.getByRole('button', { name: 'SMTP / Correo', exact: true }).click();
  await expect(rows).toHaveCount(0);
  await page.getByRole('button', { name: 'Menú de cuenta', exact: true }).click();
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page).toHaveURL('/');
  await page.getByRole('button', { name: 'Acceso', exact: true }).click();
  await page.locator('#login-email').fill('fixture@example.invalid');
  await page.locator('#login-password').fill('Synthetic!fixture7');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/admin/);
  await page.goto('/admin?section=configuracion');
  await page.getByRole('button', { name: 'SMTP / Correo', exact: true }).click();
  await expect(rows).toHaveCount(0);
  expect(JSON.stringify(state.messages)).toBe(original);
  state.messages.push({ ...state.messages[0], id: '10000000-0000-4000-8000-000000000002', created_at: '2026-10-25T10:02:00Z' });
  await page.getByRole('button', { name: 'Actualizar correo', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('10000000-0000-4000-8000-000000000002');
  expect(state.calls.filter(c => c.method !== 'GET' && c.path.startsWith('/api/system/'))).toEqual([]);
});

test('an old asynchronous monitor response cannot restore cleared rows', async ({ page }) => {
  const { state } = await mailFixture(page);
  const rows = page.getByRole('table').locator('tbody tr');
  await expect(rows).toHaveCount(1);
  state.delayNext = true;
  await page.getByRole('button', { name: 'Actualizar correo', exact: true }).click();
  await expect.poll(() => Boolean(state.release)).toBe(true);
  await confirmClear(page);
  await expect(rows).toHaveCount(0);
  await state.release();
  await expect(page.getByRole('button', { name: 'Actualizar correo', exact: true })).toBeEnabled();
  await expect(rows).toHaveCount(0);
});

test('storage errors are reported and never presented as a successful durable clear', async ({ page }) => {
  await mailFixture(page);
  const rows = page.getByRole('table').locator('tbody tr');
  await expect(rows).toHaveCount(1);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('uasspain.mail-history.')) throw new DOMException('Storage denied');
      return original.call(this, key, value);
    };
  });
  await confirmClear(page);
  await expect(rows).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Monitorización de correo' })).toContainText('No se pudo guardar la limpieza');
});

test('cross-tab visibility changes cannot be undone by an older marker', async ({ page }) => {
  await mailFixture(page);
  const rows = page.getByRole('table').locator('tbody tr');
  await expect(rows).toHaveCount(1);
  await page.evaluate(() => {
    const key = 'uasspain.mail-history.v1.00000000-0000-4000-8000-000000000001';
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: JSON.stringify({ through: Date.parse('2026-10-25T10:01:00Z'), ids: [] }) }));
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: JSON.stringify({ through: 1, ids: [] }) }));
  });
  await expect(rows).toHaveCount(0);
});

test('shared SMTP parameters appear once with two identities across themes and responsive widths',async({page},info)=>{
  const{state}=await mailFixture(page);state.services.contact.settings.shared_transport=true;state.services.contact.settings.config=null;
  await page.reload();await page.getByRole('button',{name:'SMTP / Correo',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Correo bidireccional',exact:true})).toHaveCount(1);await expect(page.getByRole('heading',{name:'Correo automático',exact:true})).toHaveCount(1);
  await expect(page.getByLabel('Servidor SMTP',{exact:true})).toHaveCount(1);await expect(page.getByLabel('Contraseña SMTP',{exact:true})).toHaveCount(1);await expect(page.getByRole('button',{name:'Enviar correo de prueba',exact:true})).toHaveCount(2);
  for(const theme of ['light','dark'])for(const width of [320,768,1440]){await page.setViewportSize({width,height:1000});await page.evaluate(value=>{localStorage.setItem('theme',value);window.dispatchEvent(new StorageEvent('storage',{key:'theme',newValue:value,storageArea:localStorage}));},theme);await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
  await page.screenshot({path:info.outputPath('smtp-dual-responsive.png'),fullPage:true});
  const accessibility=await new AxeBuilder({page}).include('form[aria-label="Configuración SMTP"], form[aria-label="Correo bidireccional"], form[aria-label="Correo automático"]').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(accessibility.violations).toEqual([]);
  expect(state.calls.filter(c=>c.method!=='GET'&&c.path.startsWith('/api/system/'))).toEqual([]);
});
test('consent for contact never authorizes the automatic service',async({page})=>{
  const{state,smtp}=await mailFixture(page),automatic=page.getByRole('form',{name:'Correo automático',exact:true});
  await smtp.getByLabel('Destinatario de prueba',{exact:true}).fill('contact-probe@example.invalid');await smtp.getByLabel(consent,{exact:true}).check();
  await automatic.getByLabel('Destinatario de prueba',{exact:true}).fill('automatic-probe@example.invalid');await expect(automatic.getByRole('button',{name:sendName,exact:true})).toBeDisabled();
  await automatic.getByLabel(consent,{exact:true}).check();await automatic.getByRole('button',{name:sendName,exact:true}).click();await expect(automatic.getByRole('status').last()).toHaveText('Prueba SMTP simulada aceptada.');
  expect(state.calls.filter(c=>c.path.endsWith('/test/'))).toEqual([{path:'/api/system/smtp/services/automatic/test/',method:'POST',payload:{recipient:'automatic-probe@example.invalid',revision:'saved-automatic',confirm_authorized_recipient:true,request_id:expect.stringMatching(/^[0-9a-f-]{36}$/)}}]);
});
test('stored API mode blocks administration without changing provider settings',async({page})=>{
  const{state}=await mailFixture(page);state.apiBlocked=true;await page.reload();await page.getByRole('button',{name:'SMTP / Correo',exact:true}).click();
  for(const title of ['Correo bidireccional','Correo automático']){const form=page.getByRole('form',{name:title,exact:true});await expect(form.getByRole('alert')).toContainText('El modo API continúa guardado.');await expect(form.getByRole('button',{name:'Guardar configuración',exact:true})).toBeDisabled();await expect(form.getByRole('button',{name:sendName,exact:true})).toBeDisabled();}
  await expect(page.getByRole('form',{name:'Configuración SMTP',exact:true}).getByRole('button',{name:'Guardar configuración',exact:true})).toBeDisabled();expect(state.calls.filter(c=>c.method!=='GET'&&c.path.startsWith('/api/system/'))).toEqual([]);
});
test('independent credentials require an explicit provider need and never reveal the saved password',async({page})=>{
  const{state}=await mailFixture(page),automatic=page.getByRole('form',{name:'Correo automático',exact:true});
  await automatic.getByRole('combobox').first().selectOption('independent');await expect(automatic).toContainText('Sin credencial guardada.');await automatic.getByLabel('El proveedor exige autenticación independiente para este servicio.',{exact:true}).check();
  await automatic.getByLabel('Servidor SMTP',{exact:true}).fill('automatic.fixture.invalid');await automatic.getByLabel('Usuario SMTP',{exact:true}).fill('automatic-fixture');await automatic.getByLabel('Contraseña SMTP',{exact:true}).fill('SyntheticFixture!8');
  await automatic.getByRole('button',{name:'Guardar configuración',exact:true}).click();await expect(automatic.getByRole('status').last()).toContainText('Configuración guardada.');await expect(automatic.getByLabel('Contraseña SMTP',{exact:true})).toHaveValue('');
  await page.reload();await page.getByRole('button',{name:'SMTP / Correo',exact:true}).click();await expect(automatic.getByLabel('Servidor SMTP',{exact:true})).toHaveValue('automatic.fixture.invalid');await expect(automatic.getByLabel('Contraseña SMTP',{exact:true})).toHaveValue('');
  expect(state.calls.filter(c=>c.method==='PUT')).toHaveLength(1);expect(state.calls.find(c=>c.method==='PUT')?.payload).toMatchObject({settings:{shared_transport:false,independent_auth_required:true},password:'SyntheticFixture!8'});expect(state.calls.filter(c=>c.path.endsWith('/test/'))).toEqual([]);
});

test('mail service forms pass light-theme accessibility checks with independent authentication fields',async({page})=>{
  await mailFixture(page);await page.evaluate(()=>{localStorage.setItem('theme','light');window.dispatchEvent(new StorageEvent('storage',{key:'theme',newValue:'light',storageArea:localStorage}));});
  const result=await new AxeBuilder({page}).include('form[aria-label="Configuración SMTP"], form[aria-label="Correo bidireccional"], form[aria-label="Correo automático"]').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(result.violations).toEqual([]);
});


test('an uncertain service test remains blocked after refresh even if consent is checked again',async({page})=>{const{state,smtp}=await mailFixture(page);state.testStatus=503;state.testState='UNKNOWN';await smtp.getByLabel('Destinatario de prueba',{exact:true}).fill('uncertain@example.invalid');await smtp.getByLabel(consent,{exact:true}).check();await smtp.getByRole('button',{name:sendName,exact:true}).click();await expect(smtp.getByRole('status').last()).toContainText('Resultado incierto');await expect(smtp).toContainText('UNKNOWN');await smtp.getByLabel(consent,{exact:true}).check();await expect(smtp.getByRole('button',{name:sendName,exact:true})).toBeDisabled();await page.reload();await page.getByRole('button',{name:'SMTP / Correo',exact:true}).click();await expect(smtp).toContainText('UNKNOWN');expect(state.calls.filter(c=>c.path.endsWith('/test/'))).toHaveLength(1);});
