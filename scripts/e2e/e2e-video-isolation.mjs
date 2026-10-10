import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {concurrentFixtures,loginFixture} from './concurrent-fixtures.mjs';
import {root,sql,sleep} from './auth-fixtures.mjs';
const WebSocket=createRequire(resolve(root,'frontend/package.json'))('ws');
const report={time:new Date().toISOString(),origin:'http://127.0.0.1:8010',gates:[],errors:[]};
const gate=(ok,name)=>{assert.ok(ok,name);report.gates.push(name);};
const sockets=[];let seed;
async function connect(client,id){
 const ws=new WebSocket(`ws://127.0.0.1:8010/ws/videollamada/${id}/?window_id=${client.windowId}`,{origin:'http://localhost:8010',headers:{Cookie:Object.entries(client.cookies).map(([k,v])=>k+'='+v).join('; ')}}),events=[];
 ws.on('error',()=>{});ws.on('message',b=>events.push(JSON.parse(b.toString())));sockets.push(ws);
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);ws.once('unexpected-response',(_r,res)=>{res.resume();reject(Error('Denied '+res.statusCode));});});
 return {ws,events};
}
async function received(s,predicate){for(let n=0;n<100;n++){const e=s.events.find(predicate);if(e)return e;await sleep(50);}throw Error('Expected isolated signal missing');}
try{
 seed=await concurrentFixtures(8);const [teacher,foreign,a,b]=await Promise.all([1,2,3,4].map(i=>loginFixture(seed.fixtures[i]))),tid=seed.fixtures[1].id;
 for(const i of [3,4])sql(`UPDATE accounts_userprofile SET assigned_instructor_id='${tid}' WHERE id='${seed.fixtures[i].id}'`);
 const privateCalls=[];
 for(const i of [3,4]){const result=await teacher.call('/api/videollamadas/','POST',{alumno_id:seed.fixtures[i].id,estado:'activa',room_id:'forged-shared-room'});gate(result.status===201&&!result.body.is_conference,'private_call_created_'+i);privateCalls.push(result.body);}
 const [ca,cb]=privateCalls;gate(ca.room_id!==cb.room_id&&ca.room_id!=='forged-shared-room','same_instructor_private_rooms_are_independent');
 const [ta,sa,tb,sb]=await Promise.all([connect(teacher,ca.id),connect(a,ca.id),connect(teacher,cb.id),connect(b,cb.id)]);
 gate((await received(ta,e=>e.type==='welcome')).moderator===true&&(await received(sa,e=>e.type==='welcome')).moderator===false,'instructor_moderates_private_call');
 ta.ws.send(JSON.stringify({type:'offer',sdp:'private-A-marker',sender_id:'forged'}));await received(sa,e=>e.sdp==='private-A-marker');await sleep(250);
 gate(!sb.events.some(e=>e.sdp==='private-A-marker')&&!tb.events.some(e=>e.sdp==='private-A-marker'),'no_signal_or_metadata_from_A_reaches_B');
 sb.ws.send(JSON.stringify({type:'answer',sdp:'private-B-marker'}));await received(tb,e=>e.sdp==='private-B-marker');await sleep(250);gate(!sa.events.some(e=>e.sdp==='private-B-marker')&&!ta.events.some(e=>e.sdp==='private-B-marker'),'B_signal_stays_in_B');
 try{await connect(b,ca.id);assert.fail('Foreign student socket unexpectedly accepted');}catch(e){gate(e.message==='Denied 403','foreign_student_socket_denied');}
 gate((await foreign.call(`/api/videollamadas/${ca.id}/`)).status===403,'foreign_instructor_call_denied');
 gate((await a.call('/api/videollamadas/','POST',{alumno_id:seed.fixtures[3].id,is_conference:true})).status===403,'student_cannot_create_conference');
 gate((await teacher.call('/api/videollamadas/','POST',{alumno_id:seed.fixtures[4].id,conference_call_id:ca.id})).status===403,'private_call_cannot_be_promoted_by_forged_invitation');
 gate((await teacher.call(`/api/videollamadas/${ca.id}/`,'PATCH',{estado:'finalizada'})).status===200,'private_A_ended');
 gate((await teacher.call(`/api/videollamadas/${cb.id}/`)).body.estado==='activa','ending_A_preserves_B');
 // Deliberately alias room metadata to model historical implicit classrooms.
 // Private signaling is still keyed by the call UUID, not that shared metadata.
 const legacy=await teacher.call('/api/videollamadas/','POST',{alumno_id:seed.fixtures[3].id,estado:'activa'});gate(legacy.status===201,'legacy_alias_fixture');
 sql(`UPDATE conexiones_videollamada SET room_id='${cb.room_id}' WHERE id='${legacy.body.id}'`);
 const legacySocket=await connect(a,legacy.body.id);tb.ws.send(JSON.stringify({type:'offer',sdp:'legacy-B-marker'}));await received(sb,e=>e.sdp==='legacy-B-marker');await sleep(250);gate(!legacySocket.events.some(e=>e.sdp==='legacy-B-marker'),'historical_shared_room_metadata_does_not_mix_private_signaling');
 const group=await teacher.call('/api/videollamadas/','POST',{alumno_id:seed.fixtures[3].id,is_conference:true,estado:'activa'});gate(group.status===201&&group.body.is_conference&&group.body.room_id!==cb.room_id,'explicit_conference_is_separate_from_private_call');
 const invited=await teacher.call('/api/videollamadas/','POST',{alumno_id:seed.fixtures[4].id,conference_call_id:group.body.id,estado:'activa'});gate(invited.status===201&&invited.body.is_conference&&invited.body.room_id===group.body.room_id,'explicit_owner_invitation_joins_only_owned_conference');
 gate((await foreign.call('/api/videollamadas/','POST',{alumno_id:seed.fixtures[5].id,conference_call_id:group.body.id})).status===403,'foreign_instructor_cannot_reuse_conference_id');
 const adminCall=await seed.admin.call('/api/videollamadas/','POST',{alumno_id:seed.fixtures[3].id,instructor_id:tid,estado:'activa'});gate(adminCall.status===201&&adminCall.body.moderador_id===tid,'classroom_instructor_moderates_even_admin_initiation');
 const guest=await connect(seed.admin,adminCall.body.id);gate((await received(guest,e=>e.type==='welcome')).moderator===false,'administrator_is_not_classroom_moderator');
 gate((await teacher.call(`/api/videollamadas/${group.body.id}/`,'PATCH',{estado:'finalizada'})).status===200,'explicit_conference_ended');
 gate((await teacher.call(`/api/videollamadas/${invited.body.id}/`)).body.estado==='finalizada','conference_end_closes_its_invited_rows');
 gate((await teacher.call(`/api/videollamadas/${cb.id}/`)).body.estado==='activa','conference_end_preserves_private_B');
 report.result='PASS';
}catch(e){report.result='FAIL';report.errors.push(e.message);process.exitCode=1;}finally{
 for(const socket of sockets)socket.terminate();if(seed)await seed.cleanup();
 mkdirSync(resolve(root,'.run/video-isolation'),{recursive:true});writeFileSync(resolve(root,'.run/video-isolation/result.json'),JSON.stringify(report,null,2));console.log('VIDEO_ISOLATION='+report.result+' GATES='+report.gates.length);
}
