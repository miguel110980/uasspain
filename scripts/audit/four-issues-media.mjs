import { chromium,expect } from '../../frontend/node_modules/@playwright/test/index.mjs';
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {work,origin as labOrigin,loadProtected,verifyLabIdentity,client,login,env} from './four-issues-lab-common.mjs';
import {originalOrigin,publicHost,preservedAccount,originalVideoClient} from './original-video-client.mjs';

const originalRegression=process.argv.includes('--original-regression');
const origin=originalRegression?originalOrigin:labOrigin;
if(!originalRegression)verifyLabIdentity();
const phase=process.argv.includes('--after-fix')?'reconnection-after-fix':process.argv.includes('--baseline')?'baseline':process.argv.includes('--reconnect')?'candidate-reconnection':'candidate';
const fixture=loadProtected(resolve(work,'actors.dpapi'),'UASSpain|four-issues-20261117|actors|v1');
const staff=process.argv.includes('--staff');
let teacher=staff?{name:'admin',role:'admin',email:'e2e-admin@test.local',password:env.CLOSURE_ADMIN_PASSWORD}:fixture.actors.find(a=>a.name==='oldTeacher');
let student=fixture.actors.find(a=>a.name===(staff?'oldTeacher':'student'));
if(originalRegression){
  if(staff)throw Error('Original administrator credentials are not supplied to this runner');
  const actors=[];
  for(const email of ['instructor.prueba@example.invalid','alumno.prueba@example.invalid']){
    const account=preservedAccount(email),actor=originalVideoClient();
    if((await actor.call('/api/auth/context/','POST',{})).status!==200||(await actor.call('/api/auth/login/','POST',{email:account.email,password:account.password})).status!==200)throw Error('Preserved account login failed');
    const me=await actor.call('/api/auth/me/');if(me.status!==200)throw Error('Preserved profile unavailable');
    actors.push({...account,...me.body.profile,role:me.body.session_role});await actor.call('/api/auth/logout/','POST',{});
  }
  [teacher,student]=actors;
}
const deviceAuthorization=process.argv.includes('--owner-authorized-devices');
const report={observed_at:new Date().toISOString(),scope:originalRegression?'Rebuilt original Docker, two preserved authorized test accounts; new ordinary test-call records only, no academic/account changes; both clients local, not external proof':'Two independent authenticated browser contexts in the existing isolated lab, physical devices only; no fake devices or original writes',device_permission:deviceAuthorization?'Camera/microphone granted only to these owned browser contexts under owner authorization of all necessary actions':'Browser permission left for owner intervention',pair:staff?'admin-instructor':'instructor-student',phase,checks:[],samples:[],signaling:[]};
const file=`docs/audits/evidence/2026-11-17-${originalRegression?'original-video-regression':staff?'admin-instructor':'four-issues'}-media-${phase}.json`;
const save=()=>writeFileSync(file,JSON.stringify(report,null,2)+'\n');
const browser=await chromium.launch({channel:'msedge',headless:false,...(originalRegression?{args:[`--host-resolver-rules=MAP ${publicHost} 192.168.1.34`]}:{})});
const sessions=[];
let callId;
for(const actor of [teacher,student]) {
  const context=await browser.newContext({viewport:{width:1100,height:800}});
  if(deviceAuthorization)await context.grantPermissions(['camera','microphone'],{origin});
  await context.addInitScript(()=>{const Native=window.RTCPeerConnection;const peers=[],media=[],sockets=[],tracks=[];Object.defineProperty(window,'__uasAuditPeers',{value:peers});Object.defineProperty(window,'__uasMediaAcquisition',{value:media});Object.defineProperty(window,'__uasAuditSockets',{value:sockets});Object.defineProperty(window,'__uasLocalTracks',{value:tracks});window.RTCPeerConnection=class extends Native {constructor(...args){super(...args);peers.push(this);}};const Socket=window.WebSocket;window.WebSocket=class extends Socket{constructor(...args){super(...args);sockets.push(this);}};const acquire=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async constraints=>{try{const stream=await acquire(constraints);tracks.push(...stream.getTracks());media.push({state:'ACQUIRED',kinds:stream.getTracks().map(t=>t.kind)});return stream;}catch(error){media.push({state:'ERROR',name:error.name});throw error;}};});
  const page=await context.newPage();
  page.on('websocket',socket=>{
    const path=new URL(socket.url()).pathname;if(!path.includes('/videollamada/'))return;
    const record={role:actor.role,path,sent:{},received:{}};report.signaling.push(record);save();
    for(const [event,direction] of [['framesent','sent'],['framereceived','received']])socket.on(event,frame=>{try{const type=JSON.parse(String(frame.payload)).type;if(typeof type==='string'&&['welcome','join','ping','pong','offer','answer','ice_candidate','hangup'].includes(type)){record[direction][type]=(record[direction][type]??0)+1;save();}}catch{}});
  });
  page.on('response',async response=>{if(response.request().method()==='POST'&&response.url().endsWith('/api/videollamadas/')&&response.status()===201){try{callId=(await response.json()).id;report.call_id=callId;save();}catch{}}});
  await page.goto(origin+'/?auth=login',{waitUntil:'domcontentloaded'});
  await page.locator('#login-email').fill(actor.email);await page.locator('#login-password').fill(actor.password);
  await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await page.waitForURL(new RegExp('/('+actor.role+'|elegir-panel)$'));if(new URL(page.url()).pathname==='/elegir-panel'){await page.getByRole('button',{name:new RegExp('^'+(actor.role==='instructor'?'Instructor':'Alumno'))}).click();await page.waitForURL(new RegExp('/'+actor.role+'$'));}await page.locator('aside').waitFor({state:'visible'});
  sessions.push({actor,page,context});
}
const a=sessions[0].page,b=sessions[1].page;
await a.locator('aside').getByRole('button',{name:'Videollamada',exact:true}).click();
await a.locator('.glass-card:visible').filter({has:a.getByText(`${student.nombre} ${student.apellidos}`,{exact:true})}).getByRole('button',{name:'Llamar',exact:true}).click();
const notification=await b.getByRole('status').filter({hasText:'Llamada entrante'}).waitFor({state:'visible',timeout:15000}).then(()=>true).catch(()=>false);
report.initial_notification_visible=notification;save();
await b.locator('aside').getByRole('button',{name:'Videollamada',exact:true}).click();
if(staff)await b.getByRole('tab',{name:'Administradores',exact:true}).click();
await b.getByRole('button',{name:staff?'Unirse':'Unirse a la llamada',exact:true}).click();
await expect(a.getByRole('dialog',{name:'Videollamada UASSPAIN'})).toBeVisible();
await expect(b.getByRole('dialog',{name:'Videollamada UASSPAIN'})).toBeVisible();
console.log('READY_REAL_DEVICE_WINDOWS: '+(staff?'caller admin and recipient instructor':'caller instructor and recipient student')+'; waiting for owner device permission if prompted');
async function sample(){
  const snapshots=[];
  for(const {actor,page} of sessions){
    const data=await page.evaluate(async()=>{
      const videos=[...document.querySelectorAll('video')].map(v=>({label:v.getAttribute('aria-label'),width:v.videoWidth,height:v.videoHeight,frames:v.getVideoPlaybackQuality().totalVideoFrames,paused:v.paused,tracks:[...(v.srcObject?.getTracks()??[])].map(t=>({kind:t.kind,state:t.readyState,enabled:t.enabled}))}));
      const peers=[];
      for(const pc of window.__uasAuditPeers??[]){const stats=[...(await pc.getStats()).values()];peers.push({connection:pc.connectionState,ice:pc.iceConnectionState,dtls:stats.filter(s=>s.type==='transport').map(s=>s.dtlsState),local_candidate_types:[...new Set(stats.filter(s=>s.type==='local-candidate').map(s=>s.candidateType))],remote_candidate_types:[...new Set(stats.filter(s=>s.type==='remote-candidate').map(s=>s.candidateType))],rtp:stats.filter(s=>['inbound-rtp','outbound-rtp'].includes(s.type)).map(s=>({type:s.type,kind:s.kind,bytesReceived:s.bytesReceived,bytesSent:s.bytesSent,packetsReceived:s.packetsReceived,packetsSent:s.packetsSent,framesDecoded:s.framesDecoded,totalSamplesReceived:s.totalSamplesReceived})),selected_pair:stats.filter(s=>s.type==='candidate-pair'&&s.nominated&&s.state==='succeeded').map(s=>({state:s.state,bytesSent:s.bytesSent,bytesReceived:s.bytesReceived}))});}
      const streams=[...document.querySelectorAll('video')].map(v=>v.srcObject?.id).filter(Boolean);
      return {secure_context:window.isSecureContext,media:window.__uasMediaAcquisition,acquired_tracks:window.__uasLocalTracks.map(t=>({kind:t.kind,state:t.readyState,enabled:t.enabled})),distinct_streams:streams.length===2&&new Set(streams).size===2,videos,peers,error:document.querySelector('[role="dialog"] [role="alert"]')?.textContent??null};
    });snapshots.push({role:actor.role,...data});
  }
  const sample={at:new Date().toISOString(),snapshots};report.samples.push(sample);save();console.log(JSON.stringify(sample));
}
const input=createInterface({input:process.stdin});
let processing=Promise.resolve();
input.on('line',line=>{processing=processing.then(async()=>{
  const action=line.trim();
  if(action==='stats'){await sample();return;}
  if(action==='offline'){await sessions[1].context.setOffline(true);report.checks.push({id:'RECIPIENT_CONTEXT_OFFLINE',status:'EXECUTED_TEST_CONTEXT_ONLY'});save();console.log('RECIPIENT_CONTEXT_OFFLINE');return;}
  if(action==='online'){await sessions[1].context.setOffline(false);report.checks.push({id:'RECIPIENT_CONTEXT_ONLINE',status:'EXECUTED_TEST_CONTEXT_ONLY'});save();console.log('RECIPIENT_CONTEXT_ONLINE');return;}
  if(action==='signal_drop_peer'||action==='signal_drop_admin'){const target=action.endsWith('peer')?b:a;await target.evaluate(()=>{for(const socket of window.__uasAuditSockets){if(socket.url.includes('/videollamada/')&&socket.readyState===WebSocket.OPEN)socket.close(1000,'authorized signaling reconnection test');}});report.checks.push({id:action,status:'EXECUTED_REAL_SIGNALING_CLOSE_IN_TEST_CONTEXT'});save();console.log('REAL_SIGNAL_SOCKET_CLOSED');return;}
  if(action==='reload_peer'){await b.reload();await b.locator('aside').waitFor({state:'visible'});await b.locator('aside').getByRole('button',{name:'Videollamada',exact:true}).click();if(staff)await b.getByRole('tab',{name:'Administradores',exact:true}).click();console.log('RECIPIENT_RELOADED');return;}
  if(['mute_admin','unmute_admin','camera_off_admin','camera_on_admin','mute_peer','unmute_peer','camera_off_peer','camera_on_peer'].includes(action)){
    const page=action.endsWith('_peer')?b:a;
    const label=action.startsWith('mute_')?'Silenciar micrófono':action.startsWith('unmute_')?'Activar micrófono':action.startsWith('camera_off_')?'Apagar cámara':'Activar cámara';
    await page.getByRole('button',{name:label,exact:true}).click();await sample();console.log('CONTROL_EXECUTED:'+action);return;
  }
  if(action==='recall'){await a.locator('article:visible').filter({has:a.getByText(`${student.nombre} ${student.apellidos}`,{exact:true})}).getByRole('button',{name:'Llamar',exact:true}).click();console.log('RECALL_EXECUTED');return;}
  if(action==='join'){await b.getByRole('button',{name:staff?'Unirse':'Unirse a la llamada',exact:true}).click();console.log('JOIN_EXECUTED');return;}
  if(action==='reject'){await b.getByRole('button',{name:'Rechazar llamada',exact:true}).click();report.checks.push({id:'RECIPIENT_REJECT',status:'EXECUTED'});save();console.log('REJECT_EXECUTED');return;}
  if(action==='hangup'){await a.getByRole('button',{name:'Colgar',exact:true}).click();report.checks.push({id:'CALLER_HANGUP',status:'EXECUTED'});save();console.log('HANGUP_EXECUTED');return;}
  if(action==='close'){
    if(callId){const actor=originalRegression?originalVideoClient():client();await login(actor,teacher.email,teacher.password);const r=await actor.call(`/api/videollamadas/${callId}/`,'PATCH',{estado:'finalizada'});report.cleanup_call_http=r.status;if(originalRegression)await actor.call('/api/auth/logout/','POST',{});}
    await browser.close();report.status='CLOSED_WITH_EVIDENCE';save();input.close();process.exit(0);
  }
  console.log('UNKNOWN_ACTION');
}).catch(error=>{report.error_type=error.name;save();console.log('ACTION_BLOCKED:'+error.name);});});
await sample();
