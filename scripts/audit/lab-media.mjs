/** Real devices only. Observe ICE/DTLS/RTP without changing application UI/security. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '../../frontend/node_modules/@playwright/test/index.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),origin='http://127.0.0.1:18010',project='uasspain-mail-audit-closure-630870e0';
const output=resolve(root,'docs/audits/evidence/2026-11-16-lab-media.json');
function load(file,entropy){try{return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`Add-Type -AssemblyName System.Security;$b=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes('${file.replaceAll("'","''")}'),[Text.Encoding]::UTF8.GetBytes('${entropy}'),[Security.Cryptography.DataProtectionScope]::CurrentUser);try{[Console]::Write([Text.Encoding]::UTF8.GetString($b))}finally{[Array]::Clear($b,0,$b.Length)}`],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}))}catch{throw Error('Protected synthetic fixture unavailable')}}
const fixture=load(resolve(root,'.run/audit-20261116/lab-fixtures.dpapi'),'UASSpain|audit-20261116|lab-fixtures|v1'),env=load(resolve(root,'.run/closure-20261109-630870e0/api-lab.dpapi'),'UASSpain|closure20261109|630870e0');
assert.equal(fixture.project,project);assert.equal(fixture.owner,'audit-20261116');
const teacher=fixture.actors.find(x=>x.role==='instructor'),student=fixture.actors.find(x=>x.role==='alumno'&&x.index===0),actors=[teacher,student];
const images=JSON.parse(readFileSync(resolve(root,'docs/audits/evidence/2026-11-16-existing-lab.json'),'utf8')).images;
for(const [service,label] of [['backend-e2e','backend'],['web-e2e','frontend'],['postgres-e2e',null]]){
 const c=JSON.parse(execFileSync('docker',['inspect',`${project}-${service}-1`],{encoding:'utf8',windowsHide:true}))[0];assert.equal(c.Config.Labels['com.docker.compose.project'],project);assert.equal(c.Config.Labels['uasspain.fixture'],'closure-20261109-630870e0');if(label)assert.equal(JSON.parse(execFileSync('docker',['image','inspect',c.Config.Image],{encoding:'utf8',windowsHide:true}))[0].Id,images.find(x=>x.service===label).image);
}
function client(){const jar=new Map(),id=randomUUID();return{async call(path,method='GET',data){assert.ok(path.startsWith('/api/'));const r=await fetch(origin+path,{method,headers:{Origin:origin,'X-UASSpain-Window-Id':id,'Content-Type':'application/json',Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')},body:data===undefined?undefined:JSON.stringify(data)});for(const line of r.headers.getSetCookie()){const p=line.split(';')[0],at=p.indexOf('=');jar.set(p.slice(0,at),p.slice(at+1))}let body;try{body=await r.json()}catch{body=null}return{status:r.status,body}}}}
const report={started_at:new Date().toISOString(),project,origin,images,status:'RUNNING',stage:'PREPARING',scope:'Two real Edge clients, synthetic instructor/student, physical local devices, existing lab and actual updated images; no fake devices/permissions grant, external NAT/WAN/TURN certification or original writes',checks:[],samples:[],cleanup:[],original_writes:0,deletions:0,audible_audio:'NOT_RUN',external_networks:'BLOCKED',raw_sdp_ice_credentials_saved:false};
const save=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const gate=(id,ok,observed={})=>{report.checks.push({id,status:ok?'PASS':'FAIL',observed});save();assert.ok(ok,id)};
let admin,owner,browser,callId;const activated=[],pages=[];
async function snapshot(page){return await page.evaluate(async()=>{
 const peers=[];for(const pc of window.__uasRealPeers||[]){const all=[...((await pc.getStats()).values())],byId=new Map(all.map(x=>[x.id,x]));const transports=all.filter(x=>x.type==='transport').map(x=>{const pair=byId.get(x.selectedCandidatePairId);return{dtls_state:x.dtlsState,ice_state:x.iceState,srtp_cipher:x.srtpCipher,tls_version:x.tlsVersion,selected_pair:pair?{state:pair.state,nominated:pair.nominated,bytes_sent:pair.bytesSent,bytes_received:pair.bytesReceived,rtt:pair.currentRoundTripTime,local_type:byId.get(pair.localCandidateId)?.candidateType,remote_type:byId.get(pair.remoteCandidateId)?.candidateType,protocol:byId.get(pair.localCandidateId)?.protocol}:null}});
  peers.push({connection:pc.connectionState,ice:pc.iceConnectionState,signaling:pc.signalingState,local_sdp_type:pc.localDescription?.type,remote_sdp_type:pc.remoteDescription?.type,transport:transports,rtp:all.filter(x=>['inbound-rtp','outbound-rtp'].includes(x.type)).map(x=>({direction:x.type,kind:x.kind,bytes_sent:x.bytesSent,bytes_received:x.bytesReceived,packets_sent:x.packetsSent,packets_received:x.packetsReceived,packets_lost:x.packetsLost,jitter:x.jitter,frames_encoded:x.framesEncoded,frames_decoded:x.framesDecoded})),sources:all.filter(x=>x.type==='media-source').map(x=>({kind:x.kind,audio_level:x.audioLevel,total_audio_energy:x.totalAudioEnergy,width:x.width,height:x.height,frames_per_second:x.framesPerSecond})),senders:pc.getSenders().filter(x=>x.track).map(x=>({kind:x.track.kind,enabled:x.track.enabled,muted:x.track.muted,state:x.track.readyState}))})
 }return{peers,videos:[...document.querySelectorAll('video')].map(v=>({label:v.getAttribute('aria-label'),width:v.videoWidth,height:v.videoHeight,time:v.currentTime,ready:v.readyState,paused:v.paused,muted:v.muted})),secure_context:isSecureContext};
})}
try{
 admin=client();await admin.call('/api/auth/context/','POST',{});gate('LAB_ADMIN_LOGIN',(await admin.call('/api/auth/login/','POST',{email:'e2e-admin@test.local',password:env.CLOSURE_ADMIN_PASSWORD})).status===200);
 for(const actor of actors){assert.ok(actor.apellidos==='Synthetic'&&actor.nombre.startsWith('Audit1611 ')&&actor.email.endsWith(`-${fixture.suffix}@test.local`));const p=await admin.call(`/api/profiles/${actor.id}/`);gate('OWNED_BLOCKED_ACTOR:'+actor.role,p.status===200&&p.body.email===actor.email&&p.body.status==='bloqueado');activated.push(actor);gate('TEMPORARILY_ACTIVATE:'+actor.role,(await admin.call(`/api/profiles/${actor.id}/`,'PATCH',{status:'activo'})).status===200)}
 owner=client();await owner.call('/api/auth/context/','POST',{});gate('TEACHER_API_LOGIN',(await owner.call('/api/auth/login/','POST',{email:teacher.email,password:teacher.password})).status===200);
 browser=await chromium.launch({channel:'msedge',headless:false});
 for(const actor of actors){const context=await browser.newContext({viewport:{width:1100,height:800}});
  await context.addInitScript(()=>{const Native=window.RTCPeerConnection;const peers=[];Object.defineProperty(window,'__uasRealPeers',{value:peers});window.RTCPeerConnection=class extends Native{constructor(...args){super(...args);peers.push(this)}}});
  const page=await context.newPage();pages.push({page,role:actor.role});page.on('response',async r=>{if(r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/videollamadas/'&&r.status()===201){try{const body=await r.json();callId=body.id;report.call_id=callId;save()}catch{}}});
  await page.goto(origin+'/',{waitUntil:'networkidle'});await page.getByRole('button',{name:/^acceso$/i}).click();await page.locator('#login-email').fill(actor.email);await page.locator('#login-password').fill(actor.password);await page.getByRole('button',{name:/^iniciar sesión$/i}).click();await page.waitForURL(u=>u.pathname==='/'+actor.role||u.pathname==='/elegir-panel');if(new URL(page.url()).pathname==='/elegir-panel'){await page.getByRole('button',{name:/^Instructor/}).click();await page.waitForURL(u=>u.pathname==='/instructor')}
  await page.locator('aside:visible').first().getByRole('button',{name:'Videollamada',exact:true}).click();await expect(page.locator('main:visible').first().getByRole('heading',{name:'Videoconferencia',exact:true})).toBeVisible();
 }
 const a=pages[0].page,b=pages[1].page;
 await a.locator('.glass-card:visible').filter({has:a.getByText(`${student.nombre} ${student.apellidos}`,{exact:true})}).getByRole('button',{name:'Llamar',exact:true}).click();
 await b.getByRole('button',{name:'Unirse a la llamada',exact:true}).click();
 report.stage='AWAITING_REAL_MEDIA_PERMISSION';save();console.log('AWAITING_REAL_MEDIA_PERMISSION: two real Edge windows; no automated permission override');
 let connected=false;
 for(let i=0;i<180;i++){const sample=await Promise.all(pages.map(async p=>({role:p.role,...await snapshot(p.page)})));if(sample.every(x=>x.peers.some(p=>p.connection==='connected'))){report.samples.push({at:new Date().toISOString(),phase:'connected',clients:sample});connected=true;break}if(i%15===0){report.pending=sample.map(x=>({role:x.role,peers:x.peers.length,local_video:x.videos.some(v=>v.label==='Tu cámara'&&v.width>0)}));save()}await new Promise(r=>setTimeout(r,1000))}
 if(!connected){report.status='BLOCKED';report.reason='Real media permission/device/connection not established within bounded wait; no protection bypass or fake media used';save()}
 else{
  gate('TWO_REAL_PEER_CONNECTIONS',true);report.permission_wait_observed=report.pending;delete report.pending;report.stage='COLLECTING_REAL_STATS';save();
  await new Promise(r=>setTimeout(r,8000));report.samples.push({at:new Date().toISOString(),phase:'steady',clients:await Promise.all(pages.map(async p=>({role:p.role,...await snapshot(p.page)})))});save();
  for(const role of ['instructor','alumno']){const before=report.samples[0].clients.find(x=>x.role===role),after=report.samples[1].clients.find(x=>x.role===role);const peer=after.peers.find(x=>x.connection==='connected');
   gate('SDP_OFFER_ANSWER:'+role,['offer','answer'].includes(peer.local_sdp_type)&&['offer','answer'].includes(peer.remote_sdp_type)&&peer.local_sdp_type!==peer.remote_sdp_type);
   gate('SELECTED_ICE_AND_DTLS:'+role,peer.transport.some(t=>t.dtls_state==='connected'&&t.selected_pair?.state==='succeeded'&&t.selected_pair.bytes_sent>0&&t.selected_pair.bytes_received>0),{transports:peer.transport});
   for(const kind of ['audio','video'])for(const direction of ['inbound-rtp','outbound-rtp']){const bytes=x=>x.rtp.filter(r=>r.kind===kind&&r.direction===direction).reduce((s,r)=>s+(r.bytes_sent||r.bytes_received||0),0),previous=before.peers.find(x=>x.connection==='connected');gate(`REAL_RTP_GROWS:${role}:${kind}:${direction}`,bytes(peer)>bytes(previous),{increase:bytes(peer)-bytes(previous)})}
   gate('REMOTE_VIDEO_ACTUALLY_DECODES:'+role,after.videos.some(v=>v.label?.startsWith('Cámara participante')&&v.width>0&&v.height>0&&v.ready>=2&&!v.paused)&&peer.rtp.some(r=>r.direction==='inbound-rtp'&&r.kind==='video'&&r.frames_decoded>0));
  }
  for(const p of pages){await p.page.getByRole('button',{name:'Silenciar micrófono',exact:true}).click();gate('MIC_OFF:'+p.role,(await snapshot(p.page)).peers.some(x=>x.senders.some(t=>t.kind==='audio'&&t.enabled===false)));await p.page.getByRole('button',{name:'Activar micrófono',exact:true}).click();await p.page.getByRole('button',{name:'Apagar cámara',exact:true}).click();gate('CAMERA_OFF:'+p.role,(await snapshot(p.page)).peers.some(x=>x.senders.some(t=>t.kind==='video'&&t.enabled===false)));await p.page.getByRole('button',{name:'Activar cámara',exact:true}).click()}
  report.stage='COMPLETE_LOCAL_STATS';report.status='PASS';
 }
}catch(error){report.status='FAIL';report.reason=error instanceof assert.AssertionError?'Failed gate; see checks':`${error.name}: real-device laboratory operation interrupted`;process.exitCode=1}
finally{
 if(callId&&owner)try{const ended=await owner.call(`/api/videollamadas/${callId}/`,'PATCH',{estado:'finalizada'});report.cleanup.push({id:'SYNTHETIC_CALL_FINALIZED',status:ended.status===200?'PASS':'FAIL',http:ended.status})}catch{report.cleanup.push({id:'SYNTHETIC_CALL_FINALIZED',status:'BLOCKED'})}
 await browser?.close();for(const actor of [...activated].reverse())try{const r=await admin.call(`/api/profiles/${actor.id}/`,'PATCH',{status:'bloqueado'});assert.equal(r.status,200);assert.equal((await admin.call(`/api/profiles/${actor.id}/`)).body.status,'bloqueado');report.cleanup.push({id:'OWNED_ACTOR_REBLOCKED',profile_id:actor.id,status:'PASS'})}catch{report.cleanup.push({id:'OWNED_ACTOR_REBLOCKED',status:'FAIL'});report.status='FAIL'}
 report.completed_at=new Date().toISOString();save();if(report.status==='FAIL')process.exitCode=1;
}
console.log(JSON.stringify({status:report.status,stage:report.stage,checks:report.checks.length,report:'docs/audits/evidence/2026-11-16-lab-media.json'}));
