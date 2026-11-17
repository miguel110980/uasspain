import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {work,project,loadProtected,verifyLabIdentity,client,login,env,originalFingerprint} from './four-issues-lab-common.mjs';
verifyLabIdentity();
const fixture=loadProtected(resolve(work,'actors.dpapi'),'UASSpain|four-issues-20261117|actors|v1');
assert.equal(fixture.project,project);assert.equal(fixture.actors.length,4);
const report={observed_at:new Date().toISOString(),scope:'Deactivate only the four synthetic actors proven by this protected fixture; retain accounts, calls, messages, exams and attachments; original unchanged',project,profiles:[],checks:[],deletions:0};
const before=originalFingerprint(),admin=client();await login(admin,'e2e-admin@test.local',env.CLOSURE_ADMIN_PASSWORD);
const originalList=await admin.call('/api/profiles/');assert.equal(originalList.status,200);
const save=()=>writeFileSync('docs/audits/evidence/2026-11-17-four-issues-lab-retirement.json',JSON.stringify(report,null,2)+'\n');
for(const actor of fixture.actors){
  assert.match(actor.id,/^[0-9a-f-]{36}$/);assert.equal(actor.apellidos,'Synthetic');assert.equal(actor.nombre,`Audit1711 ${actor.name}`);assert.ok(actor.email.endsWith(`-${fixture.suffix}@test.local`));
  const current=await admin.call(`/api/profiles/${actor.id}/`);assert.equal(current.status,200);
  for(const key of ['id','email','nombre','apellidos','role'])assert.equal(current.body[key],actor[key]);
  const blocked=await admin.call(`/api/profiles/${actor.id}/`,'PATCH',{status:'bloqueado'});assert.equal(blocked.status,200);
  const after=await admin.call(`/api/profiles/${actor.id}/`);assert.equal(after.body.status,'bloqueado');assert.equal(after.body.id,actor.id);
  const fresh=client();assert.equal((await fresh.call('/api/auth/context/','POST',{})).status,200);assert.equal((await fresh.call('/api/auth/login/','POST',{email:actor.email,password:actor.password})).status,401);
  report.profiles.push({id:actor.id,name:actor.name,status:'bloqueado',provenance:'four-issues-20261117',record_retained:true,new_login_denied:true});save();
}
const finalList=await admin.call('/api/profiles/');assert.equal(finalList.status,200);
assert.deepEqual(finalList.body.map(p=>p.id).sort(),originalList.body.map(p=>p.id).sort());
assert.ok(originalList.body.filter(p=>!fixture.actors.some(a=>a.id===p.id)).every(p=>JSON.stringify(finalList.body.find(q=>q.id===p.id))===JSON.stringify(p)));
assert.equal(before,originalFingerprint());report.unowned_profiles_preserved=true;report.original_profiles_credentials_preserved=true;report.status='PASS_ONLY_OWN_SYNTHETIC_ACCOUNTS_BLOCKED';save();console.log(JSON.stringify({status:report.status,deactivated:report.profiles.length,deletions:0}));
