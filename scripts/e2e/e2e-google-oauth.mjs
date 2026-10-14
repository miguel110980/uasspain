import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createDecipheriv,createHash,createHmac,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {adminClient,apiClient,registerFixture,sql as fixtureSql,uuid,mailFiles,backend,sleep} from './auth-fixtures.mjs';
const sql=query=>{try{return fixtureSql(query)}catch{throw new Error('Isolated fixture SQL failed')}};
const dir='.run/google-oauth-20261013';mkdirSync(dir,{recursive:true});
const report={scope:'isolated synthetic OIDC server, actual Rust/PostgreSQL/HTTPS; not Google acceptance',gates:[],errors:[],mainWrites:0,profiles:[]};
const gate=(ok,name)=>{assert.ok(ok,name);report.gates.push(name);console.log('PASS '+name)};
const beforeConfig=sql("SELECT COALESCE((SELECT value::text FROM core_systemsetting WHERE key='google_oauth'),'null')");
const beforeSecret=sql("SELECT COALESCE((SELECT ciphertext FROM core_systemsecret WHERE key='google_oauth_client_secret'),'')");
const beforeRows=sql("SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]') FROM core_systemsetting s WHERE key='google_oauth'");
const beforeSecretRows=sql("SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]') FROM core_systemsecret s WHERE key='google_oauth_client_secret'");
const mailBaseline=sql("SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY key),'[]') FROM core_systemsetting s WHERE key IN ('smtp','mail_mode','mail_api','mail_api_draft')");
const initialFiles=new Set(mailFiles()),initialJobs=new Set(sql('SELECT id FROM mail_outbox').split('\n').filter(Boolean));
const initialFlows=new Set(sql('SELECT id FROM google_oauth_flow').split('\n').filter(Boolean));
const initialLogs=new Set(sql('SELECT id FROM core_auditlog').split('\n').filter(Boolean));
const master=Buffer.from(process.env.E2E_FIELD_ENCRYPTION_KEY,'base64');
function decrypt(value){const bytes=Buffer.from(value.slice(3),'base64url');const c=createDecipheriv('aes-256-gcm',master,bytes.subarray(0,12));c.setAuthTag(bytes.subarray(-16));return Buffer.concat([c.update(bytes.subarray(12,-16)),c.final()]).toString()}
const blind=value=>createHmac('sha256',createHash('sha256').update(master).update('|blind-index|v1').digest()).update(value).digest('hex');
const q=x=>`'${x.replaceAll("'","''")}'`;
const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function restart(){const info=JSON.parse(docker(['inspect',backend]))[0];assert.equal(info.Config.Labels['com.docker.compose.project'],'uasspain-e2e');docker(['restart',backend]);for(let n=0;n<100;n++){try{if((await fetch((process.env.E2E_API_BASE||'http://127.0.0.1:8010')+'/api/health/ready/')).status===200)return}catch{}await sleep(150)}throw new Error('Fixture did not recover')}
async function issue(url,subject,claims={}){const r=await fetch('http://127.0.0.1:8072/fixtures/issue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({authorization_url:url,subject,claims})});assert.equal(r.status,200);return r.json()}
async function begin(client,purpose,password='',subject=randomUUID(),claims={}){const path=purpose==='login'?'/api/auth/google/oauth/start/':`/api/system/google-oauth/${purpose}/`;const r=await client.call(path,'POST',{current_password:password});assert.equal(r.status,200,`start ${purpose}`);const ticket=await issue(r.body.authorization_url,subject,claims);return{ticket,url:r.body.authorization_url,path:purpose==='login'?'/api/auth/google/oauth/complete/':'/api/system/google-oauth/complete/'}}
const finish=(client,flow)=>client.call(flow.path,'POST',{state:flow.ticket.state,code:flow.ticket.code});
async function save(client,overrides={}){const current=(await client.call('/api/system/google-oauth/')).body;return client.call('/api/system/google-oauth/','PUT',{client_id:'1234-uasspain-fixture.apps.googleusercontent.com',corporate_email:'info@uasspain.com',enabled:false,expected_revision:current.revision,...overrides})}
try{
 const root=await adminClient();
 for(const role of ['admin','admin','instructor','alumno']){const f=await registerFixture('TEMP Google OAuth');report.profiles.push(f);gate((await apiClient().call('/api/auth/verify-otp/','POST',{email:f.email,code:f.code})).status===200,'fixture_verified_'+role);gate((await root.call(`/api/profiles/${uuid(f.id)}/`,'PATCH',{status:'activo',role,roles:[role]})).status===200,'fixture_activated_'+role)}
 const [a,b,instructor,student]=report.profiles;const clients=[];
 for(const f of report.profiles){const c=apiClient();gate((await c.call('/api/auth/login/','POST',{email:f.email,password:f.password})).status===200,'fixture_login_'+f.id.slice(0,8));clients.push(c)}
 const [admin,other,teacher,pupil]=clients;
 gate((await apiClient().call('/api/system/google-oauth/')).status===401,'anonymous_configuration_denied');
 for(const c of [teacher,pupil]){gate((await c.call('/api/system/google-oauth/')).status===403,'non_admin_configuration_denied');gate((await c.call('/api/system/google-oauth/link/','POST',{current_password:'synthetic'})).status===403,'non_admin_link_denied')}
 gate((await save(admin,{client_id:'invalid'})).status===400,'invalid_client_rejected');
 gate((await save(admin,{enabled:true,client_secret:'synthetic-google-oauth-secret'})).status===400,'unverified_api_activation_denied'); // pragma: allowlist secret - synthetic
 const saved=await save(admin,{client_secret:'synthetic-google-oauth-secret'});gate(saved.status===200&&!saved.body.enabled&&saved.body.client_secret_configured,'configuration_saved_disabled'); // pragma: allowlist secret - synthetic
 gate(!JSON.stringify(saved.body).includes('synthetic-google-oauth-secret'),'secret_never_returned');
 gate(saved.body.redirect_uri==='https://localhost:8444/auth/google/callback','redirect_from_trusted_public_origin');
 const encrypted=sql("SELECT ciphertext FROM core_systemsecret WHERE key='google_oauth_client_secret'");gate(encrypted.startsWith('v1:'),'client_secret_encrypted');
 gate((await save(admin)).status===200&&sql("SELECT ciphertext FROM core_systemsecret WHERE key='google_oauth_client_secret'")===encrypted,'empty_secret_preserves_existing_value');
 gate((await admin.call('/api/system/google-oauth/verify/','POST',{current_password:'wrong-synthetic-password'})).status===403,'reauthentication_required');
 const verified=await begin(admin,'verify',a.password);const params=new URL(verified.url).searchParams;
 gate(params.get('response_type')==='code'&&params.get('code_challenge_method')==='S256'&&!!params.get('nonce')&&!!params.get('state')&&!params.has('client_secret'),'authorization_code_pkce_state_nonce');
 gate((await finish(admin,verified)).status===200,'signed_synthetic_exchange_verified');
 const v=(await admin.call('/api/system/google-oauth/')).body;gate(v.status==='VERIFIED_DISABLED'&&!v.enabled&&!v.linked,'verification_does_not_enable_or_link');
 gate((await save(admin,{enabled:true})).status===200,'explicit_verified_activation');
 gate((await apiClient().call('/api/public/oauth/google/')).body.configured===true,'public_login_only_after_verification');
 gate((await apiClient().call('/api/auth/google/','POST',{id_token:'synthetic-invalid-token'})).status===400,'legacy_credentials_cannot_bypass_code_flow');
 const subject=randomUUID();const linked=await begin(admin,'link',a.password,subject,{email:b.email,hd:'test.local'});
 gate((await finish(admin,linked)).status===200,'explicit_admin_identity_linked');
 gate(sql(`SELECT google_subject_lookup FROM accounts_userprofile WHERE id=${q(a.id)}`)===blind('google:'+subject)&&sql(`SELECT google_subject_lookup IS NULL FROM accounts_userprofile WHERE id=${q(b.id)}`)==='t','email_collision_does_not_link_other_account');
 const occupied=await begin(other,'link',b.password,subject);gate((await finish(other,occupied)).status===400,'unique_subject_cannot_move_between_accounts');
 const fresh=apiClient();const login=await begin(fresh,'login','',subject);gate((await finish(fresh,login)).status===200,'linked_subject_login');gate((await fresh.call('/api/auth/me/')).body.role==='admin','existing_role_retained_without_assignment');
 const absent=await begin(apiClient(),'login','',randomUUID(),{email:a.email,hd:'test.local'});gate((await finish(apiClient(undefined,fresh.cookies),absent)).status===401,'flow_cookie_and_window_required');
 const unlinkedClient=apiClient();const noIdentity=await begin(unlinkedClient,'login','',randomUUID(),{email:a.email,hd:'test.local'});gate((await finish(unlinkedClient,noIdentity)).status===404,'matching_email_never_creates_identity');
 await restart();
 for(const claims of [{iss:'https://attacker.invalid'},{aud:'foreign-client'},{email_verified:false},{exp:1},{nonce:'foreign-nonce'},{azp:'foreign-client'},{sub:''}]){const c=apiClient();const flow=await begin(c,'login','',subject,claims);gate((await finish(c,flow)).status===401,'invalid_oidc_claim_'+Object.keys(claims)[0])}
 await restart();
 const expiredClient=apiClient();const expired=await begin(expiredClient,'login','',subject);const flowId=uuid(expired.ticket.state.split('.')[0]);sql(`UPDATE google_oauth_flow SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE id=${q(flowId)}`);gate((await finish(expiredClient,expired)).status===401,'expired_flow_denied');
 const replayClient=apiClient();const replay=await begin(replayClient,'login','',subject);gate((await finish(replayClient,replay)).status===200,'single_use_first_completion');await restart();gate((await finish(replayClient,replay)).status===401,'single_use_replay_denied_after_restart');
 const windowClient=apiClient();const windowFlow=await begin(windowClient,'login','',subject);gate((await finish(apiClient(randomUUID(),windowClient.cookies),windowFlow)).status===401,'foreign_window_denied');
 const tampered=await begin(windowClient,'login','',subject);const tamperedState=tampered.ticket.state.slice(0,-1)+'!';gate((await windowClient.call(tampered.path,'POST',{state:tamperedState,code:tampered.ticket.code})).status===401,'tampered_state_denied');
 const concurrentClient=apiClient();const concurrent=await begin(concurrentClient,'login','',subject);const races=await Promise.all([finish(concurrentClient,concurrent),finish(concurrentClient,concurrent)]);gate(races.map(r=>r.status).sort().join(',')==='200,401','concurrent_completion_exactly_one_login');
 const pupilSub=randomUUID();sql(`UPDATE accounts_userprofile SET google_subject_lookup=${q(blind('google:'+pupilSub))} WHERE id=${q(student.id)}`);
 const pupilGoogle=apiClient();const pupilFlow=await begin(pupilGoogle,'login','',pupilSub,{email:a.email,hd:null,role:'admin'});gate((await finish(pupilGoogle,pupilFlow)).status===200,'existing_student_subject_login');gate((await pupilGoogle.call('/api/auth/me/')).body.role==='alumno','google_email_cannot_grant_admin_role');
 await restart();
 gate((await admin.call('/api/system/google-oauth/unlink/','POST',{current_password:a.password,confirmation:'wrong'})).status===400,'unlink_explicit_confirmation');
 gate((await admin.call('/api/system/google-oauth/unlink/','POST',{current_password:'wrong',confirmation:'DESVINCULAR'})).status===403,'unlink_reauthentication_required');
 gate((await admin.call('/api/system/google-oauth/unlink/','POST',{current_password:a.password,confirmation:'DESVINCULAR'})).status===200,'safe_unlink');
 gate(sql(`SELECT google_subject_lookup IS NULL FROM accounts_userprofile WHERE id=${q(a.id)}`)==='t','subject_removed_only_from_owner');
 gate((await fresh.call('/api/auth/me/')).status===401&&(await concurrentClient.call('/api/auth/me/')).status===401,'all_owner_sessions_revoked');
 const conventional=apiClient();gate((await conventional.call('/api/auth/login/','POST',{email:a.email,password:a.password})).status===200,'conventional_login_survives_unlink');
 gate(sql("SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY key),'[]') FROM core_systemsetting s WHERE key IN ('smtp','mail_mode','mail_api','mail_api_draft')")===mailBaseline,'corporate_mail_configuration_unchanged');
 gate(sql("SELECT NOT has_table_privilege('uasspain_app','google_oauth_event','UPDATE') AND NOT has_table_privilege('uasspain_app','google_oauth_event','DELETE')")==='t','oauth_security_evidence_immutable_to_runtime');
 report.result='PASS';
}catch(error){report.result='FAIL';report.errors.push(error.message);process.exitCode=1}
finally{
 try{
  const ownedFlows=sql('SELECT id FROM google_oauth_flow').split('\n').filter(id=>id&&!initialFlows.has(id));report.flowIds=ownedFlows;
  for(const id of ownedFlows)sql(`DELETE FROM google_oauth_flow WHERE id=${q(uuid(id))}`);
  const ownProfiles=new Set(report.profiles.map(f=>f.id)),ownEmails=new Set(report.profiles.map(f=>f.email));
  const logs=JSON.parse(sql("SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'actor',profile_id,'target',instance_id,'flow',extra->>'flow_id')),'[]') FROM core_auditlog"));
  for(const log of logs.filter(log=>!initialLogs.has(log.id)&&(ownProfiles.has(log.actor)||ownProfiles.has(log.target)||ownedFlows.includes(log.flow))))sql(`DELETE FROM core_auditlog WHERE id=${q(uuid(log.id))}`);
  for(const id of sql('SELECT id FROM mail_outbox').split('\n').filter(id=>id&&!initialJobs.has(id))){const payload=JSON.parse(decrypt(sql(`SELECT payload_ciphertext FROM mail_outbox WHERE id=${q(uuid(id))}`)));if(ownEmails.has(payload.to))sql(`DELETE FROM mail_outbox WHERE id=${q(uuid(id))}`)}
  for(const f of report.profiles){sql(`DELETE FROM auth_tab_session WHERE profile_id=${q(f.id)}; DELETE FROM conexiones_registroconexion WHERE profile_id=${q(f.id)}; DELETE FROM accounts_userprofile WHERE id=${q(f.id)}; DELETE FROM auth_user WHERE id=${Number(f.userId)}`)}
  for(const file of mailFiles().filter(f=>!initialFiles.has(f))){assert.match(file,/^\/app\/backups\/e2e-mailbox\/[0-9a-f-]{36}\.enc$/);const message=JSON.parse(decrypt(docker(['exec',backend,'cat',file])));if(ownEmails.has(message.to))docker(['exec',backend,'rm','--',file])}
  sql("DELETE FROM core_systemsetting WHERE key='google_oauth'; DELETE FROM core_systemsecret WHERE key='google_oauth_client_secret'");
  if(beforeConfig!=='null')sql(`INSERT INTO core_systemsetting SELECT * FROM jsonb_populate_recordset(NULL::core_systemsetting,${q(beforeRows)}::jsonb)`);
  if(beforeSecret)sql(`INSERT INTO core_systemsecret SELECT * FROM jsonb_populate_recordset(NULL::core_systemsecret,${q(beforeSecretRows)}::jsonb)`);
  report.protectedEvidenceRetained=true;report.profileResidue=report.profiles.filter(f=>sql(`SELECT count(*) FROM accounts_userprofile WHERE id=${q(f.id)}`)!=='0').length;assert.equal(report.profileResidue,0);
 }catch{report.result='FAIL';report.errors.push('Exact isolated cleanup failed');process.exitCode=1}
 master.fill(0);writeFileSync(dir+'/google-api.json',JSON.stringify({...report,profiles:report.profiles.map(f=>({id:f.id,userId:f.userId}))},null,2));
}
console.log(`GOOGLE_OAUTH=${report.result} GATES=${report.gates.length} MAIN_WRITES=0 REAL_GOOGLE=NOT_RUN`);
if(report.errors.length)console.log(report.errors.join('; '));
