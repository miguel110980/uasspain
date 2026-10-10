import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { check, root, sleep, sql } from './auth-fixtures.mjs';
import { concurrentFixtures, loginFixture } from './concurrent-fixtures.mjs';
const WebSocket = createRequire(resolve(root,'frontend/package.json'))('ws');
const before = process.argv.includes('--before');
const report = { phase:before?'before':'after', gates:[], deliveryMs:[], errors:[], channels:20, crossChannelMessages:0, duplicates:0, missingMessages:0 };
const gate = (ok,name) => { report.gates.push({name,pass:Boolean(ok)}); if (!ok && !before) throw new Error(name); };
let seed;
const sockets = [];
async function connect(client,room='/ws/conexiones/') {
  const ws = new WebSocket(`ws://127.0.0.1:8010${room}?window_id=${client.windowId}`, { origin:'http://localhost:8010', headers:{Cookie:Object.entries(client.cookies).map(([k,v])=>`${k}=${v}`).join('; ')},handshakeTimeout:15000 });
  const events=[];
  ws.on('message', data => { try { events.push(JSON.parse(data.toString())); } catch {} });
  ws.on('error',()=>{});
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
  sockets.push(ws);
  return {ws,events};
}
async function deniedSocket(client,room) {
  const ws = new WebSocket(`ws://127.0.0.1:8010/ws/chat/${room}/?window_id=${client.windowId}`, { origin:'http://localhost:8010',headers:{Cookie:Object.entries(client.cookies).map(([k,v])=>`${k}=${v}`).join('; ')},handshakeTimeout:10000 });
  return new Promise(resolve=>{ws.once('open',()=>{ws.terminate();resolve(false)});ws.once('unexpected-response',(_req,res)=>{res.resume();ws.terminate();resolve([400,403,404].includes(res.statusCode))});ws.on('error',()=>{});});
}
async function waitEvent(channel, predicate, timeout=2000) {
  const start=performance.now();
  while(performance.now()-start<timeout) { const found=channel.events.find(predicate);if(found)return found;await sleep(10); }
  return null;
}
try {
  seed=await concurrentFixtures(23);
  const teachers=await Promise.all([1,2].map(i=>loginFixture(seed.fixtures[i])));
  const students=seed.fixtures.slice(3);
  for(const [i,f] of students.entries()) sql(`UPDATE accounts_userprofile SET role='alumno',roles='["alumno"]',assigned_instructor_id='${seed.fixtures[i<10?1:2].id}' WHERE id='${f.id}'`);
  const clients=await Promise.all(students.map(f=>loginFixture(f)));
  const global=await connect(seed.admin);
  const studentChannels=await Promise.all(clients.map((c,i)=>connect(c,`/ws/chat/${students[i].id}/`)));
  const teacherChannels=await Promise.all(students.map((f,i)=>connect(teachers[i<10?0:1],`/ws/chat/${f.id}/`)));
  gate(await deniedSocket(clients[0],students[1].id),'student_foreign_room_denied');
  gate(await deniedSocket(teachers[0],students[10].id),'foreign_instructor_room_denied');
  gate(await deniedSocket(seed.admin,students[0].id),'admin_student_room_denied');
  gate(await deniedSocket(clients[0],randomUUID()),'invented_room_denied');
  gate((await seed.admin.call('/api/mensajes/')).status===403,'admin_cannot_list_student_messages');
  gate((await seed.admin.call('/api/mensajes/unread/')).status===403,'admin_cannot_count_student_messages');
  gate((await seed.admin.call('/api/dashboard/counts/')).body.messages===null,'admin_dashboard_does_not_expose_private_message_counts');
  gate((await clients[0].call(`/api/mensajes/unread/?alumno_id=${students[1].id}`)).status===403,'foreign_student_unread_count_denied');
  const summaries=await teachers[0].call('/api/mensajes/summaries/');
  gate(summaries.status===200&&summaries.body.length===10&&summaries.body.every(r=>students.slice(0,10).some(f=>f.id===r.alumno_id)),'conversation_summaries_are_scoped');
  const persisted=await Promise.all(students.map((f,i)=>teachers[i<10?0:1].call('/api/mensajes/','POST',{alumno_id:f.id,contenido:`private-${f.id}`})));
  gate(persisted.every(r=>r.status===201),'private_messages_persist');
  for(const [i,c] of studentChannels.entries()) {
    const received=await waitEvent(c,e=>e.type==='message'&&e.content===`private-${students[i].id}`);
    gate(Boolean(received?.data?.id && received.data.id===persisted[i].body.id && received.data.alumno_id===students[i].id),`complete_private_event_${i}`);
    report.crossChannelMessages+=c.events.filter(e=>e.type==='message'&&e.room_id!==students[i].id).length;
  }
  const started=performance.now();
  const reply=await clients[0].call('/api/mensajes/','POST',{contenido:'bidirectional fixture'});
  const delivered=await waitEvent(teacherChannels[0],e=>e.type==='message'&&e.content==='bidirectional fixture');
  report.deliveryMs.push(+(performance.now()-started).toFixed(2));
  gate(reply.status===201&&Boolean(delivered?.data?.id),'student_to_instructor_private_delivery');
  const broadcast=await teachers[0].call('/api/mensajes/broadcast/','POST',{recipient_ids:students.slice(0,10).map(f=>f.id),contenido:'private broadcast fixture'});
  gate(broadcast.status===201&&new Set(broadcast.body.map(r=>r.id)).size===10,'broadcast_independent_rows');
  const received=await Promise.all(studentChannels.slice(0,10).map(c=>waitEvent(c,e=>e.type==='message'&&e.content==='private broadcast fixture')));
  report.missingMessages+=received.filter(e=>!e?.data?.id).length;
  gate(report.missingMessages===0,'broadcast_publishes_each_private_room');
  const count=()=>Number(sql(`SELECT count(*) FROM conexiones_mensaje WHERE alumno_id='${students[0].id}'`));
  const initial=count();
  gate((await teachers[0].call('/api/mensajes/broadcast/','POST',{recipient_ids:[students[0].id,students[10].id],contenido:'atomic failure fixture'})).status===403&&count()===initial,'broadcast_authorization_is_atomic');
  gate((await teachers[1].call(`/api/mensajes/?alumno_id=${students[0].id}`)).status===403,'foreign_instructor_history_denied');
  gate((await clients[1].call(`/api/mensajes/${persisted[0].body.id}/`)).status===403,'foreign_student_message_denied');
  gate((await seed.admin.call(`/api/mensajes/${persisted[0].body.id}/`)).status===403,'admin_message_detail_denied');
  gate((await clients[0].call('/api/mensajes/clear-chat/','POST',{alumno_id:students[1].id})).status===403,'student_cannot_clear_foreign_channel');
  gate((await clients[0].call(`/api/mensajes/${persisted[0].body.id}/`,'DELETE')).status===403,'student_cannot_delete_instructor_message');
  gate((await clients[0].call(`/api/mensajes/${persisted[0].body.id}/`,'PATCH',{contenido:'forbidden edit'})).status===403,'student_cannot_edit_instructor_message');
  gate((await teachers[0].call(`/api/mensajes/${reply.body.id}/`,'DELETE')).status===204,'instructor_can_moderate_incoming_student_message');
  const own=await clients[1].call('/api/mensajes/','POST',{contenido:'own deletion fixture'});
  gate(own.status===201&&(await clients[1].call(`/api/mensajes/${own.body.id}/`,'DELETE')).status===204,'student_can_delete_own_message');
  // A mark-read affects one room only; the other unread conversation survives.
  for(const i of [2,3]) await clients[i].call('/api/mensajes/','POST',{contenido:'read isolation fixture'});
  gate((await teachers[0].call('/api/mensajes/mark-read/','POST',{alumno_id:students[2].id})).status===200,'mark_read_own_channel');
  gate(sql(`SELECT count(*) FROM conexiones_mensaje WHERE alumno_id='${students[3].id}' AND remitente='alumno' AND NOT leido_instructor`)==='1','mark_read_does_not_touch_other_room');
  const absent=students[19];
  sql(`UPDATE accounts_userprofile SET assigned_instructor_id=NULL WHERE id='${absent.id}'`);
  gate((await clients[19].call('/api/mensajes/','POST',{contenido:'orphan fixture'})).status===403,'unassigned_student_cannot_send');
  const reassigned=students[4];
  gate((await seed.admin.call(`/api/profiles/${seed.fixtures[2].id}/assign-alumnos/`,'POST',{student_ids:[reassigned.id]})).status===200,'reassignment_fixture');
  await sleep(300);
  gate(teacherChannels[4].ws.readyState!==WebSocket.OPEN,'reassignment_closes_existing_socket');
  gate(await deniedSocket(teachers[0],reassigned.id),'reassignment_denies_new_socket');
  gate((await teachers[0].call(`/api/mensajes/?alumno_id=${reassigned.id}`)).status===403,'reassignment_denies_history');
  gate((await teachers[0].call('/api/mensajes/clear-chat/','POST',{alumno_id:reassigned.id})).status===403,'reassignment_denies_old_moderator');
  gate((await teachers[1].call('/api/mensajes/','POST',{alumno_id:reassigned.id,contenido:'new moderator fixture'})).status===201,'new_instructor_can_send');
  gate(global.events.every(e=>!('content'in e)&&!('contenido'in e)&&!('data'in e && e.data?.contenido)),'global_socket_has_no_private_content');
  const ordered = await Promise.all(['tie one','tie two'].map(contenido=>teachers[1].call('/api/mensajes/','POST',{alumno_id:students[18].id,contenido})));
  gate(ordered.every(r=>r.status===201),'ordered_history_fixture');
  const ids=ordered.map(r=>r.body.id).sort();
  sql(`UPDATE conexiones_mensaje SET created_date=NOW()+INTERVAL '1 minute' WHERE id IN('${ids[0]}','${ids[1]}')`);
  const history=await teachers[1].call(`/api/mensajes/?alumno_id=${students[18].id}&limit=2`);
  gate(history.status===200&&JSON.stringify(history.body.map(r=>r.id))===JSON.stringify(ids),'latest_history_has_stable_timestamp_id_order');
  report.crossChannelMessages=studentChannels.reduce((count,channel,i)=>count+channel.events.filter(e=>e.type==='message'&&e.room_id!==students[i].id).length,0);
  report.duplicates=studentChannels.reduce((count,channel)=>{
    const ids=channel.events.filter(e=>e.type==='message'&&e.data?.id).map(e=>e.data.id);
    return count+ids.length-new Set(ids).size;
  },0);
  gate(report.crossChannelMessages===0,'private_channels_do_not_mix');
  gate(report.duplicates===0,'private_delivery_has_no_duplicate_ids');
  const otherBefore=sql(`SELECT count(*) FROM conexiones_mensaje WHERE alumno_id='${students[1].id}'`);
  gate((await clients[0].call('/api/mensajes/clear-chat/','POST',{alumno_id:students[0].id})).status===200&&count()===0,'student_can_clear_own_channel');
  gate(sql(`SELECT count(*) FROM conexiones_mensaje WHERE alumno_id='${students[1].id}'`)===otherBefore,'student_clear_preserves_other_channel');
  const logout=await clients[17].call('/api/auth/logout/','POST',{});
  gate([200,204].includes(logout.status),'private_session_logout');
  studentChannels[17].ws.send(JSON.stringify({type:'ping'}));
  for(let i=0;i<100&&studentChannels[17].ws.readyState===WebSocket.OPEN;i++)await sleep(10);
  gate(studentChannels[17].ws.readyState!==WebSocket.OPEN,'revoked_private_socket_cannot_process_frames');
  gate((await clients[17].call('/api/mensajes/','POST',{contenido:'revoked fixture'})).status===401,'revoked_private_session_cannot_persist');
  console.log(`CHAT_PRIVATE_E2E=${report.gates.filter(g=>g.pass).length}/${report.gates.length}; phase=${report.phase}`);
}catch(error){report.errors.push(error.message.split('\n')[0]);console.error(`CHAT_PRIVATE_E2E=FAIL; gate=${report.errors.at(-1)}`);process.exitCode=1;}
finally{
  for(const ws of sockets)ws.terminate();
  if(seed)await seed.cleanup();
  const folder=resolve(root,'.run/concurrency-audit');mkdirSync(folder,{recursive:true});writeFileSync(resolve(folder,`chat-private-${report.phase}.json`),JSON.stringify(report,null,2));
}
