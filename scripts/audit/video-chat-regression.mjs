import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {work,loadProtected,verifyLabIdentity,client,login,origin,originalFingerprint} from './four-issues-lab-common.mjs';
const WebSocket=createRequire(resolve('frontend/package.json'))('ws');
verifyLabIdentity();
const before=originalFingerprint(),fixture=loadProtected(resolve(work,'actors.dpapi'),'UASSpain|four-issues-20261117|actors|v1');
const [teacher,student,foreign]=['oldTeacher','student','otherStudent'].map(name=>fixture.actors.find(a=>a.name===name));
const report={observed_at:new Date().toISOString(),scope:'Actual synthetic chat HTTP/WS delivery, history, reconnect and isolation in existing candidate lab; no original data writes',checks:[]},sockets=[];
const save=()=>writeFileSync('docs/audits/evidence/2026-11-17-video-chat-regression.json',JSON.stringify(report,null,2)+'\n');
const gate=(id,ok)=>{report.checks.push({id,status:ok?'PASS':'FAIL'});save();assert.ok(ok,id);};
async function connect(actor,id){const socket=new WebSocket(origin.replace('http:','ws:')+`/ws/chat/${id}/?window_id=${actor.windowId}`,actor.socketOptions),messages=[];sockets.push(socket);socket.on('error',()=>{});socket.on('message',data=>{try{messages.push(JSON.parse(data.toString()));}catch{}});await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',()=>reject(Error('Authorized fixture socket unavailable')));});return {socket,messages};}
async function delivered(channel,text){for(let i=0;i<100;i++){if(channel.messages.some(m=>m.type==='message'&&m.content===text))return true;await new Promise(resolve=>setTimeout(resolve,25));}return false;}
try{
  const a=client(),b=client(),c=client();await login(a,teacher.email,teacher.password);await login(b,student.email,student.password);await login(c,foreign.email,foreign.password);
  const fromTeacher=await connect(a,student.id),fromStudent=await connect(b,student.id),other=await connect(c,foreign.id);
  const marker='video-regression-'+randomUUID(),first=marker+'-instructor',reply=marker+'-student';
  const sent=await a.call('/api/mensajes/','POST',{alumno_id:student.id,contenido:first});gate('INSTRUCTOR_MESSAGE_REAL_WS_DELIVERY',sent.status===201&&await delivered(fromStudent,first));
  const answer=await b.call('/api/mensajes/','POST',{contenido:reply});gate('STUDENT_REPLY_REAL_WS_DELIVERY',answer.status===201&&await delivered(fromTeacher,reply));
  const history=await b.call('/api/mensajes/');gate('BOTH_MESSAGES_PERSIST_IN_HISTORY',history.status===200&&[sent.body.id,answer.body.id].every(id=>history.body.some(row=>row.id===id)));
  gate('FOREIGN_HISTORY_IDOR_DENIED',(await c.call('/api/mensajes/?alumno_id='+student.id)).status===403);
  fromStudent.socket.terminate();const reconnected=await connect(b,student.id),last=marker+'-reconnected';
  const after=await a.call('/api/mensajes/','POST',{alumno_id:student.id,contenido:last});gate('RECONNECT_RECEIVES_NEW_MESSAGE',after.status===201&&await delivered(reconnected,last));
  gate('NO_CROSS_USER_DELIVERY',!other.messages.some(m=>m.content?.includes(marker)));
  gate('NO_DUPLICATE_DELIVERY',fromTeacher.messages.filter(m=>m.content===reply).length===1&&fromStudent.messages.filter(m=>m.content===first).length===1);
  gate('ORIGINAL_PROFILES_AND_CREDENTIALS_PRESERVED',before===originalFingerprint());
  report.status='PASS_SCOPED_CHAT_REGRESSION';
}catch(error){report.status='FAIL';report.reason=error instanceof assert.AssertionError?'See failed check':error.name;process.exitCode=1;}
finally{for(const socket of sockets)socket.terminate();save();console.log(JSON.stringify({status:report.status,checks:report.checks.length}));}
