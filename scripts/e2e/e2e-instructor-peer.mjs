import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {concurrentFixtures,loginFixture} from './concurrent-fixtures.mjs';
import {root,sleep} from './auth-fixtures.mjs';
const WebSocket=createRequire(resolve(root,'frontend/package.json'))('ws');
const report={time:new Date().toISOString(),origin:'http://127.0.0.1:8010',gates:[],errors:[]};
const gate=(ok,name)=>{assert.ok(ok,name);report.gates.push(name);};
const sockets=[];let seed;
async function connect(client,path){
 const events=[],ws=new WebSocket(`ws://127.0.0.1:8010${path}?window_id=${client.windowId}`,{origin:'http://localhost:8010',headers:{Cookie:Object.entries(client.cookies).map(([k,v])=>`${k}=${v}`).join('; ')}});
 ws.on('message',b=>{try{events.push(JSON.parse(b.toString()));}catch{}});ws.on('error',()=>{});sockets.push(ws);
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);ws.once('unexpected-response',(_r,res)=>{res.resume();reject(new Error('Unexpected upgrade status '+res.statusCode));});});
 return {ws,events};
}
async function waitFor(socket,predicate){for(let i=0;i<100;i++){const e=socket.events.find(predicate);if(e)return e;await sleep(50);}throw Error('Expected private event missing');}
try{
 seed=await concurrentFixtures(8);const [a,b,student]=await Promise.all([1,2,3].map(i=>loginFixture(seed.fixtures[i])));
 const aid=seed.fixtures[1].id,bid=seed.fixtures[2].id,pair='staff-'+[aid,bid].sort().join('-');
 const aw=await connect(a,`/ws/chat/${pair}/`),bw=await connect(b,`/ws/chat/${pair}/`);
 const msg=await a.call('/api/mensajes-staff/','POST',{destinatario_id:bid,contenido:'Instructor peer owned fixture'});
 gate(msg.status===201,'instructor_peer_message_persists');await waitFor(bw,e=>e.type==='message'&&e.room_id===pair&&e.sender_id===aid&&e.content===msg.body.contenido);gate(true,'instructor_peer_private_delivery');
 const reply=await b.call('/api/mensajes-staff/','POST',{destinatario_id:aid,contenido:'Instructor peer reply owned fixture'});
 gate(reply.status===201,'instructor_peer_reply_persists');await waitFor(aw,e=>e.type==='message'&&e.room_id===pair&&e.sender_id===bid&&e.content===reply.body.contenido);gate(true,'instructor_peer_bidirectional_delivery');
 gate((await student.call('/api/mensajes-staff/','POST',{destinatario_id:aid,contenido:'denied'})).status===403,'student_staff_send_denied');
 gate((await a.call('/api/mensajes-staff/','POST',{destinatario_id:aid,contenido:'denied'})).status===403,'self_staff_send_denied');
 for(const initiator of [a,b]){
  const peer=initiator===a?bid:aid,initiatorId=initiator===a?aid:bid;
  const created=await initiator.call('/api/videollamadas/','POST',{canal:'instructores',instructor_peer_id:peer,estado:'activa',moderador_id:peer});
  gate(created.status===201&&created.body.moderador_id===initiatorId&&created.body.iniciador_id===initiatorId,'backend_first_initiator_moderates_'+(initiator===a?'a':'b'));
  const id=created.body.id;
  const joined=await (initiator===a?b:a).call('/api/videollamadas/','POST',{canal:'instructores',instructor_peer_id:initiatorId,estado:'activa'});
  gate(joined.status===201&&joined.body.id===id&&joined.body.moderador_id===initiatorId,'reverse_creation_retains_room_and_moderator');
  const [as,bs]=await Promise.all([connect(a,`/ws/videollamada/${id}/`),connect(b,`/ws/videollamada/${id}/`)]);
  const [ac,bc]=await Promise.all([waitFor(as,e=>e.type==='welcome'),waitFor(bs,e=>e.type==='welcome')]);
  gate(ac.moderator===(initiator===a)&&bc.moderator===(initiator===b),'signaling_moderator_matches_backend');
  as.ws.close();const reconnected=await connect(a,`/ws/videollamada/${id}/`);gate((await waitFor(reconnected,e=>e.type==='welcome')).moderator===(initiator===a),'reconnection_retains_moderator');
  gate((await student.call(`/api/videollamadas/${id}/`)).status===403,'student_foreign_call_denied');
  gate((await seed.admin.call(`/api/videollamadas/${id}/`)).status===403,'uninvited_admin_call_denied');
  const ownList=await b.call('/api/videollamadas/?canal=instructores');gate(ownList.status===200&&ownList.body.some(c=>c.id===id),'both_canonical_participants_list_call');
  gate((await initiator.call(`/api/videollamadas/${id}/`,'PATCH',{estado:'finalizada'})).status===200,'owned_call_ended');
 }
 gate((await student.call('/api/videollamadas/','POST',{canal:'instructores',instructor_peer_id:aid})).status===403,'student_cannot_create_instructor_room');
 gate((await a.call('/api/videollamadas/','POST',{canal:'instructores',instructor_peer_id:aid})).status===403,'self_call_denied');
 // Both opposite requests lock the same canonical participant before lookup.
 const race=await Promise.all([a.call('/api/videollamadas/','POST',{canal:'instructores',instructor_peer_id:bid}),b.call('/api/videollamadas/','POST',{canal:'instructores',instructor_peer_id:aid})]);
 gate(race.every(r=>r.status===201)&&race[0].body.id===race[1].body.id&&race[0].body.moderador_id===race[1].body.moderador_id,'simultaneous_creation_has_one_room_and_one_moderator');
 report.result='PASS';
}catch(e){report.result='FAIL';report.errors.push(e.message);throw e;}finally{
 for(const ws of sockets)ws.terminate();if(seed)await seed.cleanup();
 mkdirSync(resolve(root,'.run/instructor-peer'),{recursive:true});writeFileSync(resolve(root,'.run/instructor-peer/result.json'),JSON.stringify(report,null,2));console.log('INSTRUCTOR_PEER='+report.result+' GATES='+report.gates.length);
}
