import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {originalVideoClient,loginOriginalInstructor} from './original-video-client.mjs';
const actor=originalVideoClient();const me=await loginOriginalInstructor(actor);
const calls=await actor.call('/api/videollamadas/?canal=administracion&estado=activa');assert.equal(calls.status,200);
const owned=calls.body.filter(c=>c.id==='c1b0273e-596f-4231-9640-fc2d747677a3'&&c.instructor_id===me.id&&c.administrador_id==='e89b3e28-1f0e-49c8-948b-8a4e3eb346c8');
assert.ok(owned.length<=1);
const report={observed_at:new Date().toISOString(),scope:'Normal hangup of the one identified broken administrator/instructor call under owner authorization; no deletion, account or academic changes',calls:[],authorization:'tienes autorizacion para todo lo que se necesita'};
for(const call of owned){const result=await actor.call(`/api/videollamadas/${call.id}/`,'PATCH',{estado:'finalizada'});assert.equal(result.status,200);assert.equal(result.body.estado,'finalizada');report.calls.push({id:call.id,before:'activa',after:'finalizada'});}
report.own_diagnostic_session_logout_http=(await actor.call('/api/auth/logout/','POST',{})).status;
report.status=owned.length?'PASS_IDENTIFIED_BROKEN_CALL_ENDED_WITH_HISTORY_RETAINED':'PASS_IDENTIFIED_CALL_ALREADY_NOT_ACTIVE';
writeFileSync('docs/audits/evidence/2026-11-17-identified-broken-admin-call-ended.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
