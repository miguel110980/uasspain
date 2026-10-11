import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash,createHmac,X509Certificate} from 'node:crypto';
import {chromium} from '../../frontend/node_modules/@playwright/test/index.mjs';
const dir='.run/session-repair-20261011/';
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const pg='uasspain-e2e-postgres-e2e-1';
assert.equal(JSON.parse(docker(['inspect',pg]))[0].Config.Labels['com.docker.compose.project'],'uasspain-e2e');
const sql=q=>docker(['exec','-i',pg,'psql','-U','uasspain','-d','test_e2e_uasspain','-At','-v','ON_ERROR_STOP=1'],q);
assert.equal(sql('SELECT current_database();'),'test_e2e_uasspain');
const proof=JSON.parse(readFileSync(dir+'production-fixture.json'));
assert.equal(proof.result,'PASS');assert.equal(proof.origin,'https://localhost:8444');
const pin=createHash('sha256').update(new X509Certificate(readFileSync('.secrets/tls/edge.crt')).publicKey.export({type:'spki',format:'der'})).digest('base64');
const browser=await chromium.launch({args:['--ignore-certificate-errors-spki-list='+pin]});
const context=await browser.newContext({baseURL:proof.origin,viewport:{width:1440,height:1000}});
const accounts=[['e2e-admin@test.local','E2eAdmin_2026!','admin'],['instructor.e2e@test.local','E2eInstr_2026!','instructor'],['alumno.e2e@test.local','E2ePass_2026!','alumno'],['segundo.e2e@test.local','E2eSecond_2026!','alumno']]; // pragma: allowlist secret - disposable fixtures
const real=process.argv.includes('--real-idle');
let realKeepAlive;
const report={time:new Date().toISOString(),origin:proof.origin,buildId:proof.buildId,scope:'Four tabs in ONE browser context, exact main images, isolated DB',realIdle:real,gates:[],javascriptErrors:[],mainWrites:0};
const save=()=>writeFileSync(dir+(real?'real-idle-browser.json':'browser-sessions.json'),JSON.stringify(report,null,2));
const gate=(ok,name)=>{assert.ok(ok,name);report.gates.push(name);save();console.log('PASS | '+name);};
const binding=page=>page.evaluate(()=>sessionStorage.getItem('uasspain.window_session_id'));
const request=async(page,path,method='GET',body)=>page.evaluate(async({path,method,body})=>{
 const response=await fetch(path,{method,credentials:'include',headers:{'X-UASSpain-Window-Id':sessionStorage.getItem('uasspain.window_session_id'),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,body:await response.json()};
},{path,method,body});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try {
 await context.addInitScript(()=>{
  window.auditSockets=[];const Socket=window.WebSocket;
  window.WebSocket=class extends Socket {constructor(...args){super(...args);window.auditSockets.push(this);}};
 });
 const pages=await Promise.all(accounts.map(()=>context.newPage()));
 for(const page of pages) page.on('pageerror',e=>report.javascriptErrors.push(e.message));
 for(const page of pages) page.on('response',async r=>{if(new URL(r.url()).pathname.startsWith('/api/auth/')) {try {const body=await r.json(); report.authTrace??=[];report.authTrace.push({path:new URL(r.url()).pathname,status:r.status(),code:body?.code,windowId:r.request().headers()['x-uasspain-window-id']});}catch{}}});
 for(let i=0;i<4;i++) {
  const page=pages[i];await page.goto('/?auth=login');
  await page.getByLabel('Correo electrónico *',{exact:true}).fill(accounts[i][0]);
  await page.getByLabel('Contraseña *',{exact:true}).fill(accounts[i][1]);
  await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await page.waitForURL(`**/${accounts[i][2]}`);
  await page.locator('header h1').filter({hasText:/^Dashboard$/}).waitFor();
  gate((await request(page,'/api/auth/me/')).body.email===accounts[i][0],`tab_${i}_real_browser_login`);
 }
 const initialIds=await Promise.all(pages.map(binding));gate(new Set(initialIds).size===4,'four_distinct_tab_bindings_one_cookie_context');
 const cookies=await context.cookies();const credential=cookies.find(c=>c.name==='__Host-uasspain_context');
 gate(credential?.httpOnly&&credential.secure&&credential.sameSite==='Strict'&&credential.path==='/'&&!cookies.some(c=>['uasspain_access','uasspain_refresh'].includes(c.name)),'secure_httponly_context_cookie_no_user_jwt');
 for(let i=0;i<4;i++) {
  const page=pages[i];await page.reload();await page.locator('header h1').filter({hasText:/^Dashboard$/}).waitFor();
  gate(await binding(page)===initialIds[i],`tab_${i}_reload_keeps_binding`);
  const me=await request(page,'/api/auth/me/');gate(me.status===200&&me.body.email===accounts[i][0]&&me.body.session_role===accounts[i][2],`tab_${i}_identity_survives_other_logins_and_reloads`);
  for(let j=0;j<30;j++){if(await page.evaluate(()=>window.auditSockets.some(s=>s.readyState===WebSocket.OPEN&&new URL(s.url).pathname==='/ws/conexiones/')))break;await wait(100);}
  gate(await page.evaluate(()=>window.auditSockets.some(s=>s.readyState===WebSocket.OPEN&&s.url.startsWith('wss://')&&new URL(s.url).pathname==='/ws/conexiones/')),`tab_${i}_wss_authenticated`);
 }
 if(real) {
  const page=pages[2],me=await request(page,'/api/auth/me/');
  const deadline=Date.parse(me.body.idle_expires_at);assert.ok(deadline>Date.now()+890000);
  report.startedAt=new Date().toISOString();report.serverDeadline=me.body.idle_expires_at;save();
  const started=deadline-900000;
  realKeepAlive=setInterval(()=>{void Promise.all([0,1,3].map(i=>pages[i].locator('header h1').click())).catch(()=>{});},60000);
  for(const seconds of [840,899]) {
   await wait(Math.max(0,started+seconds*1000-Date.now()));
   const status=await request(page,'/api/auth/me/');gate(status.status===200,`real_wait_${seconds}_seconds_still_authenticated_despite_polling_and_wss`);
  }
  await page.waitForURL(/auth=login/,{timeout:10000});
  const elapsed=Date.now()-started;
  gate(elapsed>=899000&&elapsed<910000,'real_900_second_timeout_redirects_only_idle_tab');
  await page.getByText('Tu sesión ha caducado por inactividad',{exact:true}).waitFor({timeout:8000});
  gate(await page.getByText('Tu sesión ha caducado por inactividad',{exact:true}).isVisible(),'real_idle_notice_visible');
  clearInterval(realKeepAlive);
  for(const i of [0,1,3]) gate((await request(pages[i],'/api/auth/me/')).status===200,`real_tab_${i}_remains_active_after_other_tab_expires`);
  report.elapsedMs=elapsed;report.result='PASS';save();
 } else {
  const duplicate=await context.newPage();await duplicate.addInitScript(id=>{if(!sessionStorage.getItem('fixture-copied-once')){sessionStorage.setItem('uasspain.window_session_id',id);sessionStorage.setItem('fixture-copied-once','1');}},initialIds[2]);
  await duplicate.goto('/alumno');await duplicate.waitForURL(/auth=login/);
  gate((await binding(duplicate))!==initialIds[2],'duplicated_live_tab_gets_new_binding_and_no_inherited_login');await duplicate.close();
  gate((await request(pages[2],'/api/auth/me/')).status===200,'original_tab_survives_duplication');
  const opened=pages[1].waitForEvent('popup');
  await pages[1].evaluate(()=>window.open('/instructor','_blank'));
  const popup=await opened;await popup.waitForURL(/auth=login/);
  gate((await binding(popup))!==initialIds[1],'native_popup_copies_storage_but_cannot_inherit_session');
  await popup.close();
  gate((await request(pages[2],'/api/system/status/')).status===403,'student_role_cannot_access_administration');
  for(let i=0;i<3;i++) {
   const page=pages[i];const buttons=page.locator('aside:visible nav').getByRole('button');
   const labels=await buttons.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')).filter(Boolean));
   for(const label of labels) {await page.locator('aside:visible nav').getByRole('button',{name:label,exact:true}).click();}
   gate((await request(page,'/api/auth/me/')).body.email===accounts[i][0],`all_${accounts[i][2]}_panel_sections_preserve_identity`);
   await page.locator('aside:visible nav').getByRole('button',{name:'Dashboard',exact:true}).click();
  }
  const me=await request(pages[2],'/api/auth/me/');assert.match(me.body.id,/^[a-f0-9-]{36}$/);
  const backend=JSON.parse(docker(['inspect','uasspain-e2e-backend-e2e-1']))[0];
  const fieldKey=Buffer.from(backend.Config.Env.find(v=>v.startsWith('FIELD_ENCRYPTION_KEY=')).slice(21),'base64');
  const blindKey=createHash('sha256').update(fieldKey).update('|blind-index|v1').digest();
  const lookup=createHmac('sha256',blindKey).update('window:'+await binding(pages[2])).digest('hex');
  fieldKey.fill(0);blindKey.fill(0);
  const row=JSON.parse(sql(`SELECT row_to_json(s) FROM (SELECT id,profile_id FROM auth_tab_session WHERE profile_id='${me.body.id}' AND window_lookup='${lookup}' AND revoked_at IS NULL) s;`));
  assert.match(row.id,/^[a-f0-9-]{36}$/);
  const last=()=>sql(`SELECT last_activity_at FROM auth_tab_session WHERE id='${row.id}' AND profile_id='${row.profile_id}';`);
  await wait(1000);const idleBefore=last();
  await pages[2].evaluate(()=>{window.dispatchEvent(new PointerEvent('pointermove',{buttons:1}));window.scrollTo(0,300);});
  await pages[2].mouse.move(600,100);await wait(800);
  gate(last()===idleBefore,'programmatic_scroll_and_input_and_pointer_hover_do_not_renew');
  await pages[2].mouse.down();await wait(800);const down=last();
  await pages[2].mouse.move(660,100);await wait(800);await pages[2].mouse.up();
  gate(Date.parse(last())>Date.parse(down),'trusted_pressed_pointer_drag_records_activity');

  // Exact own synthetic session, never dates/patterns or a real user.
  sql(`UPDATE auth_tab_session SET last_activity_at=clock_timestamp()-INTERVAL '900 seconds' WHERE id='${row.id}' AND profile_id='${row.profile_id}';`);
  await pages[2].waitForURL(/auth=login/,{timeout:8000});
  await pages[2].getByText('Tu sesión ha caducado por inactividad',{exact:true}).waitFor({timeout:8000});
  gate(await pages[2].getByText('Tu sesión ha caducado por inactividad',{exact:true}).isVisible(),'idle_tab_redirect_and_notice');
  for(const i of [0,1,3]) gate((await request(pages[i],'/api/auth/me/')).status===200,`tab_${i}_not_expired_by_tab_2`);
  const beforeLogout=await context.cookies();
  gate((await request(pages[0],'/api/auth/logout/','POST',{})).status===200,'browser_logout_own_tab');
  gate((await context.cookies()).find(c=>c.name==='__Host-uasspain_context').value===beforeLogout.find(c=>c.name==='__Host-uasspain_context').value,'logout_does_not_delete_or_rotate_browser_credential');
  for(const i of [1,3]) gate((await request(pages[i],'/api/auth/me/')).status===200,`tab_${i}_survives_logout`);
  await context.setOffline(true);await wait(1500);await context.setOffline(false);
  await pages[1].reload();await pages[1].locator('header h1').filter({hasText:/^Dashboard$/}).waitFor();
  gate((await request(pages[1],'/api/auth/me/')).body.email===accounts[1][0],'offline_recovery_keeps_tab_identity');
  gate(report.javascriptErrors.length===0,'no_uncaught_javascript_errors');report.result='PASS';save();
 }
} catch(error){report.pages=await Promise.all(context.pages().map(async p=>({url:p.url(),binding:await binding(p).catch(()=>null),cookieNames:(await context.cookies()).map(c=>c.name),headings:await p.locator('header h1').allTextContents()})));report.result='FAIL';report.error=error.message;save();throw error;}
finally{clearInterval(realKeepAlive);await context.close();await browser.close();}
