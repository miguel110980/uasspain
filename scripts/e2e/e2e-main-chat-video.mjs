// Docker acceptance using exactly four independently owned, encrypted profiles.
// Only new namespaced profiles are changed or deleted; existing profiles stay intact.
import {chromium,expect} from '../../frontend/node_modules/@playwright/test/index.mjs';
import {approvedPhase04Fixtures} from './approved-phase04-fixtures.mjs';
import {verifyPrivateMedia} from './private-media-acceptance.mjs';
import {readFile} from 'node:fs/promises';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const origin=process.env.PHASE04_ACCEPTANCE_ORIGIN||'https://localhost';
assert.ok(['https://localhost','https://localhost:8444'].includes(origin),'Approved Docker acceptance origin');
if(origin==='https://localhost')assert.ok(process.argv.includes('--approved-phase04-fixtures'),'Main fixture writes require explicit approval after review');
const dir=process.env.PHASE04_MAIN_REPORT||'.run/phase04-main';await mkdir(dir,{recursive:true});
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
 await page.addInitScript(()=>{const Original=WebSocket;window.fixtureSockets=[];window.WebSocket=class extends Original{constructor(...args){super(...args);window.fixtureSockets.push(this);}};});
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
async function deniedSocket(page,id){return page.evaluate(id=>new Promise(resolve=>{
 const ws=new WebSocket(`wss://${location.host}/ws/videollamada/${id}/?window_id=${sessionStorage.getItem('uasspain.window_session_id')}`),timer=setTimeout(()=>{ws.close();resolve(false);},10000);
 ws.onerror=()=>{clearTimeout(timer);ws.close();resolve(true);};ws.onopen=()=>{clearTimeout(timer);ws.close();resolve(false);};
}),id);}
try{
 seed=await approvedPhase04Fixtures({origin,dir});created.push(...seed.fixtures);namespace=seed.state.namespace;
 const versionContext=await browser.newContext({ignoreHTTPSErrors:true});report.buildId=(await (await versionContext.request.get(origin+'/version.json')).json()).buildId;await versionContext.close();
 const pages=[];for(const f of created)pages.push(await login(f,f.role));const [teacher,peer,a,b]=pages;
 const me=await call(teacher,'/api/auth/me/');gate(me.status===200&&me.body.profile.id===created[0].id,'authenticated_profile_matches_real_api');
 const roster=await call(teacher,`/api/profiles/${created[0].id}/assigned-alumnos/`);gate(roster.status===200&&created.slice(2).every(f=>roster.body.some(p=>p.id===f.id)),'assigned_students_real_data');
 for(const p of [teacher,a,b])await nav(p).getByRole('button',{name:'Chat',exact:true}).click();
 for(const f of created.slice(2))await teacher.locator('main button').filter({has:teacher.getByText(f.name,{exact:true})}).filter({visible:true}).click();
 const room=teacher.getByRole('region',{name:`Conversación con ${created[2].name}`,exact:true});await expect(room).toBeVisible();
 const outbound=namespace+' instructor→A';await room.getByPlaceholder('Escribe un mensaje...').fill(outbound);await room.getByRole('button',{name:'Enviar mensaje',exact:true}).click();await expect(bubble(a,outbound)).toHaveCount(1);await expect(bubble(b,outbound)).toHaveCount(0);gate(true,'instructor_to_student_without_refresh_and_B_isolated');
 const inbound=namespace+' A→instructor';await a.getByPlaceholder('Escribe un mensaje...').fill(inbound);await a.getByRole('button',{name:'Enviar mensaje',exact:true}).click();await expect(room.getByText(inbound,{exact:true})).toHaveCount(1);gate(true,'student_to_instructor_without_refresh');
 await a.reload();await nav(a).getByRole('button',{name:'Chat',exact:true}).click();await expect(bubble(a,outbound)).toHaveCount(1);gate(true,'refresh_persists_history_without_duplicates');
 await a.context().setOffline(true);await call(teacher,'/api/mensajes/','POST',{alumno_id:created[2].id,contenido:namespace+' reconnect'});await a.context().setOffline(false);await expect(bubble(a,namespace+' reconnect')).toHaveCount(1,{timeout:20000});gate(true,'offline_reconnection_catches_up');
 gate((await call(b,`/api/mensajes/?alumno_id=${created[2].id}`)).status===403,'student_A_history_denied_to_B');
 gate((await call(peer,'/api/mensajes/','POST',{alumno_id:created[2].id,contenido:'denied'})).status===403,'unassigned_instructor_send_denied');
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
 const privateCalls=[];
 for(const student of created.slice(2)){
  const response=await call(teacher,'/api/videollamadas/','POST',{alumno_id:student.id,estado:'activa',moderador_id:student.id,...(privateCalls[0]?{room_id:privateCalls[0].room_id}:{})});
  gate(response.status===201&&response.body.moderador_id===created[0].id&&!response.body.is_conference,'private_call_authorized_'+student.id);privateCalls.push(response.body);
 }
 gate(privateCalls[0].room_id!==privateCalls[1].room_id,'same_instructor_private_rooms_are_independent');
 gate((await call(a,`/api/videollamadas/${privateCalls[1].id}/`)).status===403&&await deniedSocket(a,privateCalls[1].id),'foreign_student_API_and_WSS_denied');
 gate((await call(peer,`/api/videollamadas/${privateCalls[0].id}/`)).status===403&&await deniedSocket(peer,privateCalls[0].id),'foreign_instructor_API_and_WSS_denied');
 gate((await call(a,'/api/videollamadas/','POST',{alumno_id:created[2].id,is_conference:true,estado:'activa'})).status===403,'student_cannot_create_conference');
 gate((await call(teacher,'/api/videollamadas/','POST',{alumno_id:created[3].id,conference_call_id:privateCalls[0].id,estado:'activa'})).status===403,'private_room_id_cannot_be_promoted_to_conference');
 report.media=await verifyPrivateMedia({teacher,a,b,rooms:privateCalls,errors:report.errors});gate(true,'distinct_decoded_audio_video_and_DTLS_RTP');
 const beforeSockets=await a.evaluate(id=>window.fixtureSockets.filter(s=>s.url.includes('/ws/videollamada/'+id+'/')).length,privateCalls[0].id);
 await a.evaluate(id=>window.fixtureSockets.filter(s=>s.url.includes('/ws/videollamada/'+id+'/')&&s.readyState===WebSocket.OPEN).forEach(s=>s.close()),privateCalls[0].id);
 await expect.poll(()=>a.evaluate(id=>window.fixtureSockets.filter(s=>s.url.includes('/ws/videollamada/'+id+'/')).length,privateCalls[0].id),{timeout:20000}).toBeGreaterThan(beforeSockets);
 await expect.poll(()=>teacher.evaluate(()=>window.privateVideoAudit.every(r=>r.peers.size===1&&[...r.peers.values()].every(e=>e.pc.connectionState==='connected'))),{timeout:20000}).toBe(true);
 gate(true,'production_student_WSS_and_WebRTC_reconnect');
 gate((await call(teacher,`/api/videollamadas/${privateCalls[0].id}/`,'PATCH',{estado:'finalizada'})).status===200,'private_A_ended');
 await expect(a.getByRole('dialog',{name:'Videollamada UASSPAIN'})).toHaveCount(0,{timeout:15000});
 const stillB=await call(b,`/api/videollamadas/${privateCalls[1].id}/`);gate(stillB.status===200&&stillB.body.estado==='activa','ending_A_preserves_private_B');
 await expect(b.getByRole('dialog',{name:'Videollamada UASSPAIN'}).locator('video')).toHaveCount(2);gate(true,'ending_A_preserves_B_media');
 gate((await call(teacher,`/api/videollamadas/${privateCalls[1].id}/`,'PATCH',{estado:'finalizada'})).status===200,'private_B_ended');
 await expect(b.getByRole('dialog',{name:'Videollamada UASSPAIN'})).toHaveCount(0,{timeout:15000});
 await teacher.evaluate(async()=>{for(const r of window.privateVideoAudit){clearInterval(r.timer);r.socket.close();for(const e of r.peers.values())e.pc.close();r.stream.getTracks().forEach(t=>t.stop());r.oscillator.stop();await r.audio.close();}});
 const root=await call(teacher,'/api/videollamadas/','POST',{alumno_id:created[2].id,is_conference:true,estado:'activa'});
 gate(root.status===201&&root.body.is_conference,'explicit_conference_created');
 const invited=await call(teacher,'/api/videollamadas/','POST',{alumno_id:created[3].id,conference_call_id:root.body.id,estado:'activa'});
 gate(invited.status===201&&invited.body.is_conference&&invited.body.room_id===root.body.room_id,'only_explicit_invitation_shares_conference');
 gate((await call(peer,'/api/videollamadas/','POST',{alumno_id:created[2].id,conference_call_id:root.body.id,estado:'activa'})).status===403,'foreign_instructor_conference_reuse_denied');
 const separate=await call(teacher,'/api/videollamadas/','POST',{alumno_id:created[3].id,estado:'activa'});gate(separate.status===201&&separate.body.room_id!==root.body.room_id&&!separate.body.is_conference,'private_call_stays_separate_from_conference');
 await call(teacher,`/api/videollamadas/${root.body.id}/`,'PATCH',{estado:'finalizada'});
 gate((await call(teacher,`/api/videollamadas/${invited.body.id}/`)).body.estado==='finalizada'&&(await call(teacher,`/api/videollamadas/${separate.body.id}/`)).body.estado==='activa','ending_conference_preserves_other_private_call');
 await call(teacher,`/api/videollamadas/${separate.body.id}/`,'PATCH',{estado:'finalizada'});
 // The same four identities cover staff roles without authenticating any
 // existing account. The administrator login replaces the temporary peer's instructor session.
 const administrator=await login(created[1],'admin');
 for(const initiator of [teacher,administrator]){
  const teacherStarts=initiator===teacher;
  const response=await call(initiator,'/api/videollamadas/','POST',{canal:'administracion',...(teacherStarts?{administrador_id:created[1].id}:{instructor_id:created[0].id}),estado:'activa',moderador_id:created[teacherStarts?1:0].id});
  gate(response.status===201&&response.body.moderador_id===created[teacherStarts?0:1].id,'staff_first_initiator_'+(teacherStarts?'instructor':'administrator'));
  gate(await videoWelcome(teacher,response.body.id)===teacherStarts&&await videoWelcome(administrator,response.body.id)===!teacherStarts,'staff_WSS_moderation_'+teacherStarts);
  gate((await call(a,`/api/videollamadas/${response.body.id}/`)).status===403,'student_cannot_access_staff_room_'+teacherStarts);
  gate((await call(initiator,`/api/videollamadas/${response.body.id}/`,'PATCH',{estado:'finalizada'})).status===200,'staff_call_closed_'+teacherStarts);
 }
 const adminClass=await call(administrator,'/api/videollamadas/','POST',{alumno_id:created[2].id,estado:'activa',moderador_id:created[1].id});
 gate(adminClass.status===201&&adminClass.body.moderador_id===created[0].id,'administrator_classroom_initiation_keeps_instructor_moderator');
 gate(await videoWelcome(teacher,adminClass.body.id)===true&&await videoWelcome(administrator,adminClass.body.id)===false&&await videoWelcome(a,adminClass.body.id)===false,'classroom_WSS_teacher_only_moderator');
 gate((await call(teacher,`/api/videollamadas/${adminClass.body.id}/`,'PATCH',{estado:'finalizada'})).status===200,'admin_classroom_closed');
 const ownText='OWN-EXPORT-'+created[2].id,foreignText='OTHER-EXPORT-'+created[3].id;
 for(const [student,text] of [[created[2],ownText],[created[3],foreignText]])gate((await call(teacher,'/api/mensajes/','POST',{alumno_id:student.id,contenido:text})).status===201,'export_message_created_'+student.id);
 for(const page of [a,b])await nav(page).getByRole('button',{name:'Chat',exact:true}).click();
 await expect(bubble(a,ownText)).toHaveCount(1);await expect(bubble(b,foreignText)).toHaveCount(1);await expect(bubble(a,foreignText)).toHaveCount(0);
 const downloaded=a.waitForEvent('download');await a.getByRole('button',{name:'Exportar conversación a PDF',exact:true}).click();const pdf=await readFile(await (await downloaded).path());
 gate(pdf.subarray(0,4).toString()==='%PDF'&&pdf.toString('latin1').includes(ownText)&&!pdf.toString('latin1').includes(foreignText),'authorized_PDF_contains_only_own_conversation');report.pdf={bytes:pdf.length,sha256:createHash('sha256').update(pdf).digest('hex')};
 await seed.checkpoint(); // Journal all IDs BEFORE the authorized clear action.
 gate((await call(b,'/api/mensajes/clear-chat/','POST',{alumno_id:created[2].id})).status===403,'foreign_chat_clear_denied');
 await a.getByRole('button',{name:'Limpiar conversación',exact:true}).click();const confirmation=a.getByRole('dialog',{name:'Limpiar chat',exact:true});await expect(confirmation).toBeVisible();await confirmation.getByRole('button',{name:'Cancelar',exact:true}).click();await expect(bubble(a,ownText)).toHaveCount(1);gate(true,'cancel_clear_preserves_history');
 await a.getByRole('button',{name:'Limpiar conversación',exact:true}).click();await confirmation.getByRole('button',{name:'Limpiar chat',exact:true}).click();await expect(confirmation).toHaveCount(0);await expect(bubble(a,ownText)).toHaveCount(0);await expect(bubble(b,foreignText)).toHaveCount(1);
 gate((await call(teacher,`/api/mensajes/?alumno_id=${created[2].id}`)).body.length===0&&(await call(teacher,`/api/mensajes/?alumno_id=${created[3].id}`)).body.some(m=>m.contenido===foreignText),'clear_deletes_only_authorized_conversation');await seed.checkpoint();
 await a.reload();await nav(a).getByRole('button',{name:'Chat',exact:true}).click();await expect(bubble(a,ownText)).toHaveCount(0);gate(true,'cleared_history_stays_empty_after_reload');
 assert.deepEqual(report.errors,[]);assert.equal((await (await teacher.request.get(origin+'/version.json')).json()).buildId,report.buildId);report.result='PASS';
}catch(e){report.result='FAIL';report.failure=e.message;process.exitCode=1;}finally{
 const closed=await Promise.allSettled(contexts.map(c=>c.close()));
 for(const result of closed)if(result.status==='rejected'){report.errors.push('Temporary browser context cleanup failed');report.result='FAIL';process.exitCode=1;}
 if(seed)try{await seed.cleanup();report.cleanup=seed.state.cleanup;report.profileIds=created.map(f=>f.id);report.inventory='inventory.json';report.backup=seed.state.backup;report.TEMP_DATA_RESIDUE=seed.state.tempDataResidue;report.REAL_USER_DATA_MODIFIED=seed.state.realUserDataModified;report.REAL_USER_DATA_DELETED=seed.state.realUserDataDeleted;report.MAIN_INSTANCE_TEST_PROFILES=origin==='https://localhost'?created.length:0;report.exactCreatedRecords=seed.state.createdData.length;report.exactCleanupRecords=seed.state.deletedData.length;report.exactClearedRecords=seed.state.clearedDuringTest.length;}catch(e){report.cleanupError=e.message;process.exitCode=1;report.result='FAIL';}
 try{await browser.close();}catch{report.errors.push('Temporary browser cleanup failed');report.result='FAIL';process.exitCode=1;}
 await writeFile(dir+'/result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
