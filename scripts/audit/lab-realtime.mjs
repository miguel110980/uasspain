/** Real WS/API regression; no camera/audio simulation or media PASS. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WebSocket = createRequire(resolve(root, 'frontend/package.json'))('ws');
const origin = 'http://127.0.0.1:18010';
const output = resolve(root, 'docs/audits/evidence/2026-11-16-lab-realtime.json');
function load(file, entropy) { try { return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Security;$b=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes('${file.replaceAll("'", "''")}'),[Text.Encoding]::UTF8.GetBytes('${entropy}'),[Security.Cryptography.DataProtectionScope]::CurrentUser);try{[Console]::Write([Text.Encoding]::UTF8.GetString($b))}finally{[Array]::Clear($b,0,$b.Length)}`], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], windowsHide: true })); } catch { throw Error('Protected synthetic fixture unavailable'); } }
const fixture = load(resolve(root, '.run/audit-20261116/lab-fixtures.dpapi'), 'UASSpain|audit-20261116|lab-fixtures|v1');
const env = load(resolve(root, '.run/closure-20261109-630870e0/api-lab.dpapi'), 'UASSpain|closure20261109|630870e0');
assert.equal(fixture.project, 'uasspain-mail-audit-closure-630870e0');
const teacher = fixture.actors.find(x => x.role === 'instructor');
const students = fixture.actors.filter(x => x.role === 'alumno').sort((a,b) => a.index-b.index);
assert.equal(students.length, 2);
const report = { started_at: new Date().toISOString(), project: fixture.project, scope: 'Actual HTTP/WS messages, DB history and video signaling in existing synthetic lab with updated images; not original WSS, cross-network media, ICE/DTLS/RTP or audible audio', checks: [], status: 'RUNNING', multimedia: 'NOT_RUN', business_deletions: 0, original_writes: 0 };
const sockets = [];
const save = () => writeFileSync(output, JSON.stringify(report,null,2)+'\n');
const gate = (id, ok, observed = {}) => { report.checks.push({ id, status: ok ? 'PASS' : 'FAIL', observed }); save(); assert.ok(ok, id); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function client() {
  const cookies = new Map(); const windowId = randomUUID();
  return { windowId, cookies, async call(path, method='GET', data) {
    assert.ok(path.startsWith('/api/'));
    const r=await fetch(origin+path,{method,headers:{Origin:origin,'X-UASSpain-Window-Id':windowId,'Content-Type':'application/json',Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')},body:data===undefined?undefined:JSON.stringify(data)});
    for(const line of r.headers.getSetCookie()){const pair=line.split(';')[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}
    const text=await r.text(); let body;try{body=JSON.parse(text)}catch{body=null}return{status:r.status,body};
  }};
}
async function login(account) { const c=client();await c.call('/api/auth/context/','POST',{});const r=await c.call('/api/auth/login/','POST',{email:account.email,password:account.password});gate('LOGIN:'+account.role,r.status===200,{http:r.status});return c; }
async function connect(actor, path) {
  const socket=new WebSocket(origin.replace('http:','ws:')+path+'?window_id='+actor.windowId,{origin,headers:{Cookie:[...actor.cookies].map(([k,v])=>k+'='+v).join('; ')},handshakeTimeout:10000});
  const events=[]; socket.on('message',data=>{try{events.push(JSON.parse(data.toString()))}catch{}}); socket.on('error',()=>{}); sockets.push(socket);
  await new Promise((accept,reject)=>{socket.once('open',accept);socket.once('error',()=>reject(Error('Authorized fixture WS did not open')))});
  return{socket,events};
}
async function denied(actor,path){
  const socket=new WebSocket(origin.replace('http:','ws:')+path+'?window_id='+actor.windowId,{origin,headers:{Cookie:[...actor.cookies].map(([k,v])=>k+'='+v).join('; ')},handshakeTimeout:10000});sockets.push(socket);socket.on('error',()=>{});
  return await new Promise(resolve=>{const timer=setTimeout(()=>{socket.terminate();resolve(0)},11000);socket.once('open',()=>{clearTimeout(timer);socket.terminate();resolve(101)});socket.once('unexpected-response',(_r,response)=>{clearTimeout(timer);response.resume();socket.terminate();resolve(response.statusCode)})});
}
async function event(channel,predicate){for(let i=0;i<200;i++){const found=channel.events.find(predicate);if(found)return found;await sleep(20)}return null;}
try{
  const admin=await login({role:'admin',email:'e2e-admin@test.local',password:env.CLOSURE_ADMIN_PASSWORD});
  const assignment=await admin.call(`/api/profiles/${teacher.id}/assign-alumnos/`,'POST',{student_ids:students.map(x=>x.id)});
  gate('ASSIGN_SECOND_OWN_STUDENT_FOR_TWO_CHANNEL_TEST',assignment.status===200,{http:assignment.status,scope:'After materials foreign-assignment checks; only owned synthetic students'});
  const instructor=await login(teacher);const clients=[];for(const student of students)clients.push(await login(student));
  const pairs=[];
  for(let i=0;i<2;i++)pairs.push({instructor:await connect(instructor,`/ws/chat/${students[i].id}/`),student:await connect(clients[i],`/ws/chat/${students[i].id}/`)});
  gate('TWO_SIMULTANEOUS_AUTHENTICATED_PRIVATE_CHANNELS',pairs.length===2);
  const suffix=randomUUID(); const messageIds=[];
  for(let i=0;i<2;i++){
    const content=`audit1611-${suffix}-instructor-${i}`;
    const r=await instructor.call('/api/mensajes/','POST',{alumno_id:students[i].id,contenido:content});
    const received=await event(pairs[i].student,x=>x.type==='message'&&x.content===content);
    gate('CHAT_INSTRUCTOR_TO_STUDENT:'+i,r.status===201&&received?.data?.id===r.body.id);
    messageIds.push(r.body.id);
  }
  const reply=`audit1611-${suffix}-student`;
  const r=await clients[0].call('/api/mensajes/','POST',{contenido:reply});
  const delivered=await event(pairs[0].instructor,x=>x.type==='message'&&x.content===reply);
  gate('CHAT_STUDENT_TO_INSTRUCTOR',r.status===201&&delivered?.data?.id===r.body.id);
  await sleep(150);
  gate('CHAT_NO_CROSS_CHANNEL_DELIVERY',!pairs[0].student.events.some(x=>x.content?.endsWith('-instructor-1'))&&!pairs[1].student.events.some(x=>x.content===reply||x.content?.endsWith('-instructor-0')));
  gate('CHAT_OBSERVED_NO_DUPLICATES',pairs.every(p=>{const ids=p.student.events.filter(x=>x.type==='message'&&x.content?.includes(suffix)).map(x=>x.data?.id);return ids.length===new Set(ids).size}));
  const history=await clients[0].call('/api/mensajes/');
  gate('CHAT_HISTORY_PERSISTENCE',history.status===200&&history.body.some(x=>x.id===messageIds[0])&&history.body.some(x=>x.id===r.body.id));
  gate('CHAT_FOREIGN_HISTORY_DENIED',(await clients[1].call('/api/mensajes/?alumno_id='+students[0].id)).status===403);
  gate('CHAT_ADMIN_PRIVATE_HISTORY_DENIED',(await admin.call('/api/mensajes/')).status===403);
  gate('CHAT_FOREIGN_WS_DENIED',[403,404].includes(await denied(clients[1],`/ws/chat/${students[0].id}/`)));
  pairs[0].student.socket.terminate();const reconnected=await connect(clients[0],`/ws/chat/${students[0].id}/`);
  const afterDrop=`audit1611-${suffix}-reconnected`;const newMessage=await instructor.call('/api/mensajes/','POST',{alumno_id:students[0].id,contenido:afterDrop});
  gate('CHAT_RECONNECT_AND_REAL_DELIVERY',newMessage.status===201&&Boolean(await event(reconnected,x=>x.type==='message'&&x.content===afterDrop)));
  const call=await instructor.call('/api/videollamadas/','POST',{canal:'alumnos',alumno_id:students[0].id,estado:'activa'});
  gate('VIDEO_CREATE_OWN_SYNTHETIC_CALL',call.status===201,{http:call.status});
  const id=call.body.id;report.synthetic_call_id=id;
  gate('VIDEO_PARTICIPANT_ACCESS',(await clients[0].call(`/api/videollamadas/${id}/`)).status===200);
  gate('VIDEO_NONPARTICIPANT_DENIED',(await clients[1].call(`/api/videollamadas/${id}/`)).status===403);
  const a=await connect(instructor,`/ws/videollamada/${id}/`),b=await connect(clients[0],`/ws/videollamada/${id}/`);
  const welcomeA=await event(a,x=>x.type==='welcome'),welcomeB=await event(b,x=>x.type==='welcome');
  gate('VIDEO_AUTHENTICATED_SIGNAL_CHANNELS',Boolean(welcomeA?.peer_id&&welcomeB?.peer_id));
  gate('VIDEO_NONPARTICIPANT_WS_DENIED',[403,404].includes(await denied(clients[1],`/ws/videollamada/${id}/`)));
  const ended=await instructor.call(`/api/videollamadas/${id}/`,'PATCH',{estado:'finalizada'});
  gate('VIDEO_FINISH_API',ended.status===200);
  for(let i=0;i<100&&[a,b].some(c=>c.socket.readyState===WebSocket.OPEN);i++)await sleep(30);
  gate('VIDEO_FINISH_REVOKES_SOCKETS',[a,b].every(c=>c.socket.readyState!==WebSocket.OPEN));
  report.status='PASS';
}catch(error){report.status='FAIL';report.reason=error instanceof assert.AssertionError?'Failed case; see gates':String(error.message).slice(0,160);process.exitCode=1}
finally{for(const s of sockets){if(s.readyState===WebSocket.OPEN||s.readyState===WebSocket.CONNECTING)s.terminate()}report.completed_at=new Date().toISOString();save()}
console.log(JSON.stringify({status:report.status,checks:report.checks.length,failed:report.checks.filter(x=>x.status==='FAIL').map(x=>x.id),report:'docs/audits/evidence/2026-11-16-lab-realtime.json',multimedia:report.multimedia}));
