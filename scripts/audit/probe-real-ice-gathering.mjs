import {chromium} from '../../frontend/node_modules/@playwright/test/index.mjs';
import {writeFileSync} from 'node:fs';
import {env,client,login,verifyLabIdentity,origin} from './four-issues-lab-common.mjs';
verifyLabIdentity();
const actor=client();await login(actor,'e2e-admin@test.local',env.CLOSURE_ADMIN_PASSWORD);
const response=await actor.call('/api/videollamadas/ice/');
if(response.status!==200)throw Error('Authenticated ICE configuration unavailable');
const browser=await chromium.launch({channel:'msedge',headless:true});
let report;
try {
  const page=await browser.newPage();await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
  report=await page.evaluate(async config=>{
    const pc=new RTCPeerConnection(config),types={},errors=[];
    const complete=new Promise(resolve=>{
      const timeout=setTimeout(()=>resolve('TIMEOUT'),15000);
      pc.onicecandidate=event=>{if(event.candidate){const type=event.candidate.type;types[type]=(types[type]??0)+1;}else{clearTimeout(timeout);resolve('COMPLETE');}};
      pc.onicecandidateerror=event=>{errors.push({code:event.errorCode});};
    });
    pc.createDataChannel('read-only-connectivity-probe');await pc.setLocalDescription(await pc.createOffer());
    const gathering=await complete;pc.close();return {gathering,candidate_types:types,error_codes:errors,source:'Actual browser ICE gathering with application-provided configuration; no camera, microphone, remote peer or media assertion'};
  },response.body);
} finally {await browser.close();}
report={observed_at:new Date().toISOString(),...report,ice_server_count:response.body.iceServers.length,status:report.candidate_types.srflx>0?'PASS_REAL_SERVER_REFLEXIVE_CANDIDATE':'BLOCKED_NO_SERVER_REFLEXIVE_CANDIDATE'};
writeFileSync('docs/audits/evidence/2026-11-17-real-ice-gathering.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
