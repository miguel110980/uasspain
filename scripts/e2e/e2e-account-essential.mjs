import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createDecipheriv,randomUUID} from 'node:crypto';
import * as original from './auth-fixtures.mjs';
const sql=q=>{try{return original.sql(q);}catch{throw new Error('Essential fixture SQL failed');}};
const initialJobs=new Set(sql('SELECT id FROM mail_outbox').split('\n').filter(Boolean));
const initialFiles=new Set(original.mailFiles());
const report={scope:'isolated runtime essential-account protection; no MAIN writes',gates:[],errors:[]};
mkdirSync('.run/account-lifecycle-20261012',{recursive:true});
const gate=(condition,name)=>{assert.ok(condition,name);report.gates.push(name);};
let fixture,fresh=original,changed=false;
function configure(id=''){try{execFileSync('powershell.exe',['-NoProfile','-File','scripts/e2e/account-essential-runtime.ps1',...(id?['-ProfileId',id]:[])],{stdio:['ignore','pipe','pipe']});}catch{throw new Error('Essential runtime fixture configuration failed');}}
async function wait(client){for(let n=0;n<100;n++){try{if((await client.call('/api/auth/me/')).status===200)return;}catch{}await original.sleep(100);}throw new Error('Essential fixture readiness timed out');}
const key=Buffer.from(process.env.E2E_FIELD_ENCRYPTION_KEY,'base64');
function decrypt(value){const bytes=Buffer.from(value.slice(3),'base64url');const c=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));c.setAuthTag(bytes.subarray(-16));return Buffer.concat([c.update(bytes.subarray(12,-16)),c.final()]).toString();}
try{
 const administrator=await original.adminClient();fixture=await original.registerFixture('TEMP Essential');report.profile={id:fixture.id,userId:fixture.userId,email:fixture.email};
 gate((await original.apiClient().call('/api/auth/verify-otp/','POST',{email:fixture.email,code:fixture.code})).status===200,'fixture_verified');
 gate((await administrator.call(`/api/profiles/${fixture.id}/`,'PATCH',{status:'activo'})).status===200,'fixture_active');
 const client=original.apiClient();gate((await client.call('/api/auth/login/','POST',{email:fixture.email,password:fixture.password})).status===200,'fixture_authenticated');
 gate((await client.call('/api/account/deactivation/')).body.can_deactivate===true,'ordinary_account_can_prepare_baja');
 configure(fixture.id);changed=true;fresh=await import('./auth-fixtures.mjs?essential='+randomUUID());await wait(client);
 const baseline=sql(`SELECT to_jsonb(p)::text FROM accounts_userprofile p WHERE id='${original.uuid(fixture.id)}'`);
 const info=await client.call('/api/account/deactivation/');gate(info.status===200&&!info.body.can_deactivate&&info.body.blocked_reason.includes('técnica'),'runtime_essential_identity_blocks_confirmation');
 gate((await client.call('/api/account/deactivate/','POST',{confirmation:'DARME DE BAJA',current_password:fixture.password,request_id:randomUUID()})).status===400,'essential_baja_rejected_by_backend');
 gate(sql(`SELECT to_jsonb(p)::text FROM accounts_userprofile p WHERE id='${fixture.id}'`)===baseline,'essential_negative_request_preserves_profile');
 gate((await client.call('/api/auth/me/')).status===200,'essential_negative_request_preserves_session');
 configure();changed=false;fresh=await import('./auth-fixtures.mjs?restored='+randomUUID());await wait(client);
 gate((await client.call('/api/account/deactivation/')).body.can_deactivate===true,'runtime_setting_restored_without_role_changes');
 report.result='PASS';
}catch(error){report.result='FAIL';report.errors.push(error instanceof assert.AssertionError?error.message:'Essential fixture gate failed');process.exitCode=1;}
finally{
 try{
  if(changed){configure();fresh=await import('./auth-fixtures.mjs?cleanup='+randomUUID());}
  if(fixture){
   const ids=sql('SELECT id FROM mail_outbox').split('\n').filter(id=>id&&!initialJobs.has(id)).map(original.uuid);
   for(const id of ids){const value=JSON.parse(sql(`SELECT to_jsonb(o) FROM mail_outbox o WHERE id='${id}'`));assert.equal(value.validity.profile_id,fixture.id);sql(`DELETE FROM mail_outbox WHERE id='${id}'`);}
   for(const path of fresh.mailFiles().filter(path=>!initialFiles.has(path))){assert.match(path,/^\/app\/backups\/e2e-mailbox\/[0-9a-f-]+\.enc$/);const raw=execFileSync('docker',['exec',fresh.backend,'cat',path],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();if(JSON.parse(decrypt(raw)).to===fixture.email)execFileSync('docker',['exec',fresh.backend,'rm','--',path],{stdio:['ignore','pipe','pipe']});}
   sql(`DELETE FROM accounts_userprofile WHERE id='${original.uuid(fixture.id)}' AND user_id=${Number(fixture.userId)}`);sql(`DELETE FROM auth_user WHERE id=${Number(fixture.userId)} AND NOT EXISTS(SELECT 1 FROM accounts_userprofile WHERE user_id=${Number(fixture.userId)})`);
   gate(sql(`SELECT count(*) FROM accounts_userprofile WHERE id='${fixture.id}'`)==='0','owned_essential_fixture_residue_zero');
  }
 }catch{report.result='FAIL';report.errors.push('Exact essential fixture cleanup could not be verified');process.exitCode=1;}
 key.fill(0);writeFileSync('.run/account-lifecycle-20261012/essential-result.json',JSON.stringify(report,null,2));
}
console.log(`ESSENTIAL_ACCOUNT=${report.result} GATES=${report.gates.length} MAIN_WRITES=0`);
if(report.errors.length)console.log(report.errors.join('; '));
