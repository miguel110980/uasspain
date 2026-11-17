import {chromium,expect} from '../../frontend/node_modules/@playwright/test/index.mjs';
import {createInterface} from 'node:readline';
import {writeFileSync} from 'node:fs';
import {preservedInstructor,originalOrigin,publicHost} from './original-video-client.mjs';

const output='docs/audits/evidence/2026-11-17-original-admin-instructor-media.json';
const report={observed_at:new Date().toISOString(),scope:'Original updated Docker; one controlled local instructor with physical devices, awaiting actual external administrator; no fake media',external_network:'AWAITING_OWNER_CONFIRMATION_NO_VPN_TAILSCALE',permission:'Owner-authorized camera and microphone only in this isolated browser context',samples:[],signaling:[],checks:[],status:'PREPARING'};
const save=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const browser=await chromium.launch({channel:'msedge',headless:false,args:[`--host-resolver-rules=MAP ${publicHost} 192.168.1.34`]});
const context=await browser.newContext({viewport:{width:1240,height:900}});await context.grantPermissions(['camera','microphone'],{origin:originalOrigin});
await context.addInitScript(()=>{
  const peers=[],media=[],sockets=[],tracks=[];Object.defineProperty(window,'__uasVideoAudit',{value:{peers,media,sockets,tracks}});
  const Native=window.RTCPeerConnection;window.RTCPeerConnection=class extends Native{constructor(...args){super(...args);peers.push(this);}};
  const NativeSocket=window.WebSocket;window.WebSocket=class extends NativeSocket{constructor(...args){super(...args);sockets.push(this);}};
  const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async constraints=>{try{const stream=await get(constraints);tracks.push(...stream.getTracks());media.push({state:'ACQUIRED',kinds:stream.getTracks().map(t=>t.kind)});return stream;}catch(error){media.push({state:'ERROR',name:error.name});throw error;}};
});
const page=await context.newPage();
page.on('websocket',socket=>{
  const path=new URL(socket.url()).pathname;if(!path.includes('/videollamada/'))return;
  const record={path,sent:{},received:{}};report.signaling.push(record);save();
  for(const [event,direction] of [['framesent','sent'],['framereceived','received']])socket.on(event,frame=>{try{const type=JSON.parse(String(frame.payload)).type;if(['welcome','join','pong','offer','answer','ice_candidate','hangup'].includes(type)){record[direction][type]=(record[direction][type]??0)+1;save();}}catch{}});
});
const account=preservedInstructor();
await page.goto(originalOrigin+'/?auth=login');await page.locator('#login-email').fill(account.email);await page.locator('#login-password').fill(account.password);account.password='';await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();await page.waitForURL(/\/(instructor|elegir-panel)$/);
if(new URL(page.url()).pathname==='/elegir-panel'){await page.getByRole('button',{name:/^Instructor/}).click();await page.waitForURL(/\/instructor$/);}
await page.locator('aside').waitFor({state:'visible'});
await page.locator('aside').getByRole('button',{name:'Videollamada',exact:true}).click();await page.getByRole('tab',{name:'Administradores',exact:true}).click();
report.status='WAITING_FOR_EXTERNAL_ADMIN_CALL';save();console.log('LOCAL_INSTRUCTOR_READY: original public domain, awaiting incoming call from external administrator');
async function snapshot(){
  const data=await page.evaluate(async()=>{
    const state=window.__uasVideoAudit,videos=[...document.querySelectorAll('video')].map(video=>({label:video.getAttribute('aria-label'),width:video.videoWidth,height:video.videoHeight,frames:video.getVideoPlaybackQuality().totalVideoFrames,paused:video.paused,muted:video.muted,tracks:[...(video.srcObject?.getTracks()??[])].map(t=>({kind:t.kind,state:t.readyState,enabled:t.enabled}))}));
    const streams=[...document.querySelectorAll('video')].map(v=>v.srcObject?.id).filter(Boolean),peers=[];
    for(const pc of state.peers){const stats=[...(await pc.getStats()).values()];peers.push({connection:pc.connectionState,ice:pc.iceConnectionState,dtls:stats.filter(s=>s.type==='transport').map(s=>s.dtlsState),local_candidate_types:[...new Set(stats.filter(s=>s.type==='local-candidate').map(s=>s.candidateType))],remote_candidate_types:[...new Set(stats.filter(s=>s.type==='remote-candidate').map(s=>s.candidateType))],rtp:stats.filter(s=>['inbound-rtp','outbound-rtp'].includes(s.type)).map(s=>({type:s.type,kind:s.kind,bytesReceived:s.bytesReceived,bytesSent:s.bytesSent,packetsReceived:s.packetsReceived,packetsSent:s.packetsSent,framesDecoded:s.framesDecoded,totalSamplesReceived:s.totalSamplesReceived})),selected_pairs:stats.filter(s=>s.type==='candidate-pair'&&s.nominated&&s.state==='succeeded').map(s=>({bytesReceived:s.bytesReceived,bytesSent:s.bytesSent}))});}
    return {secure:window.isSecureContext,media:state.media,acquired_tracks:state.tracks.map(t=>({kind:t.kind,state:t.readyState,enabled:t.enabled})),videos,distinct_streams:streams.length===2&&new Set(streams).size===2,peers,alert:document.querySelector('[role="dialog"] [role="alert"]')?.textContent??null};
  });
  const sample={at:new Date().toISOString(),...data};report.samples.push(sample);save();console.log(JSON.stringify(sample));
}
let serial=Promise.resolve();
const input=createInterface({input:process.stdin});
input.on('line',line=>{serial=serial.then(async()=>{
  const action=line.trim();if(action==='stats'){await snapshot();return;}
  if(action==='offline'||action==='online'){await context.setOffline(action==='offline');report.checks.push({id:action,status:'EXECUTED_CONTROLLED_BROWSER_NETWORK_ONLY'});save();console.log('TEST_CONTEXT_'+action.toUpperCase());return;}
  if(action==='signal_drop'){await page.evaluate(()=>{for(const socket of window.__uasVideoAudit.sockets){if(socket.url.includes('/videollamada/')&&socket.readyState===WebSocket.OPEN)socket.close(1000,'authorized reconnection test');}});report.checks.push({id:action,status:'EXECUTED_OWN_SIGNALING_SOCKET_CLOSE'});save();return;}
  if(action==='reload'){await page.reload();await page.locator('aside').waitFor({state:'visible'});await page.locator('aside').getByRole('button',{name:'Videollamada',exact:true}).click();await page.getByRole('tab',{name:'Administradores',exact:true}).click();console.log('LOCAL_VIDEO_SECTION_RELOADED');return;}
  const controls={mute:'Silenciar micrófono',unmute:'Activar micrófono',camera_off:'Apagar cámara',camera_on:'Activar cámara',hangup:'Colgar'};
  if(controls[action]){await page.getByRole('button',{name:controls[action],exact:true}).click();report.checks.push({id:action,status:'EXECUTED_REAL_CONTROL'});await snapshot();return;}
  if(action==='join'){await page.locator('article:visible').filter({has:page.getByText('Llamada entrante',{exact:true})}).getByRole('button',{name:'Unirse',exact:true}).click();report.status='REAL_CALL_JOINED';save();return;}
  if(action==='close'){const hangup=page.getByRole('button',{name:'Colgar',exact:true});if(await hangup.isVisible())await hangup.click();await browser.close();input.close();report.status='CLOSED_WITH_EVIDENCE';save();process.exit(0);}
  console.log('UNKNOWN_ACTION');
}).catch(error=>{report.action_error_type=error.name;save();console.log('ACTION_BLOCKED:'+error.name);});});
const incoming=page.locator('article:visible').filter({has:page.getByText('Llamada entrante',{exact:true})}).getByRole('button',{name:'Unirse',exact:true});
try{await incoming.waitFor({state:'visible',timeout:300000});await incoming.click();await expect(page.getByRole('dialog',{name:'Videollamada UASSPAIN'})).toBeVisible();report.status='REAL_EXTERNAL_CALL_JOINED_PENDING_STATS';save();console.log('INCOMING_CALL_JOINED_BY_LOCAL_INSTRUCTOR');await snapshot();}
catch(error){report.status='BLOCKED_AWAITING_EXTERNAL_CALL';report.wait_error_type=error.name;save();console.log('WAITING_EXTERNAL_ACTION_OR_JOIN_COMMAND');}
