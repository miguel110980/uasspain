// Docker acceptance using exactly four independently owned, encrypted profiles.
// Only new namespaced profiles are changed or deleted; existing profiles stay intact.
import {chromium,expect} from '../../frontend/node_modules/@playwright/test/index.mjs';
import {approvedFixtures} from './approved-main-fixtures.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const origin=process.env.INSTRUCTOR_ACCEPTANCE_ORIGIN||'https://localhost';
assert.ok(['https://localhost','https://localhost:8444'].includes(origin),'Approved Docker acceptance origin');
if(origin==='https://localhost')assert.ok(process.argv.includes('--approved-main-fixtures'),'Main fixture writes require explicit approval after review');
const dir=process.env.INSTRUCTOR_MAIN_REPORT||'.run/instructor-main';await mkdir(dir,{recursive:true});
let namespace;
const fixtureContainer=origin==='https://localhost'?'uasspain-backend':'uasspain-e2e-backend-e2e-1';
assert.equal(execFileSync('docker',['inspect','--format','{{index .Config.Labels "com.docker.compose.project"}}',fixtureContainer],{encoding:'utf8'}).trim(),origin==='https://localhost'?'uasspain':'uasspain-e2e');
const browser=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const report={time:new Date().toISOString(),origin,gates:[],errors:[],cleanup:false},created=[],contexts=[];let seed;
const gate=(ok,name)=>{assert.ok(ok,name);report.gates.push(name);};
const headers=async page=>({Origin:origin,'X-UASSpain-Window-Id':await page.evaluate(()=>sessionStorage.getItem('uasspain.window_session_id'))});
const call=async(page,path,method='GET',data)=>{const response=await page.request.fetch(origin+path,{method,data,headers:await headers(page)});return {status:response.status(),body:response.headers()['content-type']?.includes('json')?await response.json():null};};
async function login(account,role){
 const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000},permissions:['camera','microphone']});contexts.push(context);const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(origin+'/?auth=login');await page.locator('#login-email').fill(account.email);await page.locator('#login-password').fill(account.password);await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
 await page.waitForURL(/\/(admin|instructor|alumno|elegir-panel)$/);
 if(new URL(page.url()).pathname==='/elegir-panel')await page.getByRole('button',{name:role==='admin'?/^Administrador/:/^Instructor/}).click();
 await expect(page.locator('header h1')).toHaveText('Dashboard');return page;
}
const nav=page=>page.locator('aside:visible nav');
const bubble=(page,text)=>page.locator('p.whitespace-pre-wrap').and(page.getByText(text,{exact:true})).filter({visible:true});
async function videoWelcome(page,id){return page.evaluate(async id=>{
 const key=sessionStorage.getItem('uasspain.window_session_id');return new Promise((resolve,reject)=>{const ws=new WebSocket(`wss://${location.host}/ws/videollamada/${id}/?window_id=${key}`);const timer=setTimeout(()=>{ws.close();reject(Error('Signaling welcome timeout'));},10000);ws.onmessage=e=>{const msg=JSON.parse(e.data);if(msg.type==='welcome'){clearTimeout(timer);ws.close();resolve(msg.moderator);}};ws.onerror=()=>{clearTimeout(timer);reject(Error('Signaling authentication failed'));};});
 },id);}
try{
 seed=await approvedFixtures({origin,dir});created.push(...seed.fixtures);namespace=seed.state.namespace;
 const versionContext=await browser.newContext({ignoreHTTPSErrors:true});report.buildId=(await (await versionContext.request.get(origin+'/version.json')).json()).buildId;await versionContext.close();
 const pages=[];for(const f of created)pages.push(await login(f,f.role));const [teacher,peer,a,b]=pages;
 const me=await call(teacher,'/api/auth/me/');gate(me.status===200&&me.body.profile.id===created[0].id,'authenticated_profile_matches_real_api');
 const roster=await call(teacher,`/api/profiles/${created[0].id}/assigned-alumnos/`);gate(roster.status===200&&created.slice(2).every(f=>roster.body.some(p=>p.id===f.id)),'assigned_students_real_data');
 await teacher.screenshot({path:dir+'/instructor-dashboard.png',fullPage:true});
 for(const p of [teacher,a,b])await nav(p).getByRole('button',{name:'Chat',exact:true}).click();
 for(const f of created.slice(2))await teacher.locator('main button').filter({has:teacher.getByText(f.name,{exact:true})}).filter({visible:true}).click();
 const room=teacher.getByRole('region',{name:`Conversación con ${created[2].name}`,exact:true});await expect(room).toBeVisible();
 const outbound=namespace+' instructor→A';await room.getByPlaceholder('Escribe un mensaje...').fill(outbound);await room.getByRole('button',{name:'Enviar mensaje',exact:true}).click();await expect(bubble(a,outbound)).toHaveCount(1);await expect(bubble(b,outbound)).toHaveCount(0);gate(true,'instructor_to_student_without_refresh_and_B_isolated');
 const inbound=namespace+' A→instructor';await a.getByPlaceholder('Escribe un mensaje...').fill(inbound);await a.getByRole('button',{name:'Enviar mensaje',exact:true}).click();await expect(room.getByText(inbound,{exact:true})).toHaveCount(1);gate(true,'student_to_instructor_without_refresh');
 await a.reload();await nav(a).getByRole('button',{name:'Chat',exact:true}).click();await expect(bubble(a,outbound)).toHaveCount(1);gate(true,'refresh_persists_history_without_duplicates');
 await a.context().setOffline(true);await call(teacher,'/api/mensajes/','POST',{alumno_id:created[2].id,contenido:namespace+' reconnect'});await a.context().setOffline(false);await expect(bubble(a,namespace+' reconnect')).toHaveCount(1,{timeout:20000});gate(true,'offline_reconnection_catches_up');
 gate((await call(b,`/api/mensajes/?alumno_id=${created[2].id}`)).status===403,'student_A_history_denied_to_B');
 gate((await call(peer,'/api/mensajes/','POST',{alumno_id:created[2].id,contenido:'denied'})).status===403,'unassigned_instructor_send_denied');
 await teacher.screenshot({path:dir+'/instructor-private-chats.png',fullPage:true});
 // New staff contact and delivery through the real UI, not a mocked endpoint.
 for(const p of [teacher,peer]){await nav(p).getByRole('button',{name:'Chat',exact:true}).click();await p.getByRole('button',{name:'Administración',exact:true}).click();}
 for(const [p,f] of [[teacher,created[1]],[peer,created[0]]])await p.locator('main button').filter({has:p.getByText(f.name,{exact:true})}).filter({visible:true}).click();
 const staffText=namespace+' peer';await teacher.getByPlaceholder('Escribe un mensaje...').filter({visible:true}).fill(staffText);await teacher.getByRole('button',{name:'Enviar mensaje',exact:true}).filter({visible:true}).click();await expect(bubble(peer,staffText)).toHaveCount(1);gate(true,'instructor_peer_contact_and_real_delivery');
 for(const initiator of [teacher,peer]){
  const index=initiator===teacher?0:1,other=1-index;
  const response=await call(initiator,'/api/videollamadas/','POST',{canal:'instructores',instructor_peer_id:created[other].id,estado:'activa',moderador_id:created[other].id});gate(response.status===201&&response.body.moderador_id===created[index].id,'first_initiator_backend_moderator_'+index);
  const id=response.body.id;gate(await videoWelcome(initiator,id)===true&&await videoWelcome(pages[other],id)===false,'WSS_moderation_authoritative');
  await initiator.reload();gate((await call(initiator,`/api/videollamadas/${id}/`)).body.moderador_id===created[index].id,'moderator_survives_refresh');gate(await videoWelcome(initiator,id)===true,'moderator_survives_reconnection');
  gate((await call(a,`/api/videollamadas/${id}/`)).status===403,'student_peer_call_denied');await call(initiator,`/api/videollamadas/${id}/`,'PATCH',{estado:'finalizada'});
 }
 const fromStudent=await call(a,'/api/videollamadas/','POST',{alumno_id:created[2].id,estado:'activa',moderador_id:created[2].id});gate(fromStudent.status===201&&fromStudent.body.moderador_id===created[0].id,'student_initiation_keeps_instructor_moderator');gate(await videoWelcome(a,fromStudent.body.id)===false,'student_never_moderates');await call(teacher,`/api/videollamadas/${fromStudent.body.id}/`,'PATCH',{estado:'finalizada'});
 await nav(teacher).getByRole('button',{name:'Videollamada',exact:true}).click();await teacher.getByRole('tab',{name:'Instructores',exact:true}).click();await expect(teacher.getByRole('region',{name:'Videollamadas con instructores'}).getByText(created[1].name,{exact:true})).toBeVisible();gate(true,'new_instructor_video_tab_real_contacts');
 assert.deepEqual(report.errors,[]);assert.equal((await (await teacher.request.get(origin+'/version.json')).json()).buildId,report.buildId);report.result='PASS';
}catch(e){report.result='FAIL';report.failure=e.message;process.exitCode=1;}finally{
 await Promise.all(contexts.map(c=>c.close()));
 if(seed)try{await seed.cleanup();report.cleanup=seed.state.cleanup;report.profileIds=created.map(f=>f.id);report.inventory='inventory.json';report.backup=seed.state.backup;report.TEMP_DATA_RESIDUE=seed.state.tempDataResidue;report.REAL_USER_DATA_MODIFIED=seed.state.realUserDataModified;report.REAL_USER_DATA_DELETED=seed.state.realUserDataDeleted;report.MAIN_INSTANCE_TEST_PROFILES=origin==='https://localhost'?created.length:0;}catch(e){report.cleanupError=e.message;process.exitCode=1;report.result='FAIL';}
 await browser.close();await writeFile(dir+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
