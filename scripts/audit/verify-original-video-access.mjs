import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {originalVideoClient,preservedAccount} from './original-video-client.mjs';
const report={observed_at:new Date().toISOString(),scope:'Original HTTPS/WSS authorization; preserved accounts, only newly created diagnostic login sessions; no messages, academic edits or media sent',checks:[]};
const gate=(id,http,expected)=>{report.checks.push({id,http,status:http===expected?'PASS':'FAIL'});assert.equal(http,expected,id);};
const anonymous=originalVideoClient();gate('ANONYMOUS_ICE_DENIED',(await anonymous.call('/api/videollamadas/ice/')).status,401);
const activeId=process.argv.find(a=>a.startsWith('--active-call='))?.split('=')[1];
if(activeId)assert.match(activeId,/^[0-9a-f-]{36}$/);
const oldCall=activeId??'c1b0273e-596f-4231-9640-fc2d747677a3';
report.target_call=oldCall;report.active_call=Boolean(activeId);
for(const [label,email] of [['OTHER_INSTRUCTOR','instructor.prueba2@example.invalid'],['STUDENT',activeId?'alumno.prueba5@example.invalid':'alumno.prueba@example.invalid']]){
  const actor=originalVideoClient(),account=preservedAccount(email);
  gate(label+'_CONTEXT',(await actor.call('/api/auth/context/','POST',{})).status,200);
  gate(label+'_LOGIN',(await actor.call('/api/auth/login/','POST',{email:account.email,password:account.password})).status,200);account.password='';
  gate(label+'_FOREIGN_CALL_HTTP',(await actor.call(`/api/videollamadas/${oldCall}/`)).status,403);
  gate(label+'_FOREIGN_CALL_WSS',await actor.socketStatus(oldCall),403);
  gate(label+'_OWN_TEST_LOGOUT',(await actor.call('/api/auth/logout/','POST',{})).status,200);
}
report.status='PASS_ORIGINAL_VIDEO_SCOPE_AND_AUTHORIZATION';writeFileSync(`docs/audits/evidence/2026-11-17-original-video-${activeId?'active-call-access':'access'}.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
