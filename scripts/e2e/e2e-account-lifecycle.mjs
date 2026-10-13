// Real requests, sessions and WSS on synthetic profiles in the guarded E2E stack.
import assert from 'node:assert/strict';
import {randomUUID,createDecipheriv} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import {adminClient,apiClient,registerFixture,readMail,resetPayload,sql as fixtureSql,uuid,backend,mailFiles,sleep} from './auth-fixtures.mjs';

const dir='.run/account-lifecycle-20261012';mkdirSync(dir,{recursive:true});
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const sql=query=>{try{return fixtureSql(query);}catch{throw new Error('Guarded lifecycle fixture SQL failed');}};
const docker=args=>{try{return execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:16*1024*1024}).trim();}catch{throw new Error('Guarded lifecycle Docker operation failed');}};
const key=Buffer.from(process.env.E2E_FIELD_ENCRYPTION_KEY||'','base64');assert.equal(key.length,32);
const decrypt=value=>{if(!value.startsWith('v1:'))return value;const bytes=Buffer.from(value.slice(3),'base64url');const cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([cipher.update(bytes.subarray(12,-16)),cipher.final()]).toString();};
const report={scope:'isolated HTTPS/API/PostgreSQL/Redis/WSS; MAIN test writes=0',gates:[],errors:[],profiles:[],data:[],latencyMs:[],auditRetained:true};
const gate=(condition,name)=>{assert.ok(condition,name);report.gates.push(name);console.log('PASS '+name);};
const initialIds=new Set(sql('SELECT id FROM accounts_userprofile').split('\n').filter(Boolean));
const initialEvents=new Set(sql('SELECT id FROM account_lifecycle_event').split('\n').filter(Boolean));
const initialQueue=new Set(sql('SELECT id FROM mail_outbox').split('\n').filter(Boolean));
const initialFiles=new Set(mailFiles());
const initialMailMode=JSON.parse(sql("SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]'::jsonb) FROM core_systemsetting s WHERE key='mail_mode'"));
let unavailableModeId;
let otherProfilesBaseline;
const initialSessions=new Set(sql('SELECT id FROM auth_tab_session').split('\n').filter(Boolean));
const initialLogs=new Set(sql('SELECT id FROM conexiones_registroconexion').split('\n').filter(Boolean));
const fixtures=[],sockets=[];let rootId,rootProfile,rootSessions=[],rootLogs=[],rootResets=[],administrator,courseId,resultId,materialId,completionId,examId;
const apiBase=process.env.E2E_API_BASE||'http://127.0.0.1:8010';
const WS=createRequire(process.cwd()+'/frontend/package.json')('ws');
async function connect(client,path){const secure=apiBase.startsWith('https:');const socket=new WS(apiBase.replace(/^http/,'ws')+path+'?window_id='+client.windowId,{origin:new URL(apiBase).origin,headers:{Cookie:Object.entries(client.cookies).map(([k,v])=>`${k}=${v}`).join('; ')},...(secure?{ca:readFileSync('.secrets/tls/ca.crt')}:{}),handshakeTimeout:10000});const messages=[];socket.on('message',data=>{try{messages.push(JSON.parse(String(data)));}catch{}});socket.on('error',()=>{});let closed=false;socket.on('close',()=>{closed=true;});await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('unexpected-response',(_req,response)=>{response.resume();reject(new Error('Lifecycle WSS handshake rejected'));});socket.once('error',()=>reject(new Error('Lifecycle WSS connection failed')));});sockets.push(socket);return {socket,messages,get closed(){return closed;}};}
async function login(f){const client=apiClient();gate((await client.call('/api/auth/login/','POST',{email:f.email,password:f.password})).status===200,'login_'+f.role);return client;}
const deactivate=(client,f,request=randomUUID())=>client.call('/api/account/deactivate/','POST',{confirmation:'DARME DE BAJA',current_password:f.password,request_id:request});
const revision=id=>Number(sql(`SELECT revision FROM account_lifecycle WHERE profile_id='${uuid(id)}'`));
const list=(client,params={})=>client.call('/api/admin/students/?'+new URLSearchParams(params));
const restoreRows=(table,rows)=>{for(const row of rows){const columns=Object.keys(row).filter(column=>column!=='id');assert.ok(columns.every(column=>/^[a-z_][a-z0-9_]*$/.test(column)));sql(`UPDATE ${table} t SET (${columns.map(v=>'"'+v+'"').join(',')})=(SELECT ${columns.map(v=>'r."'+v+'"').join(',')} FROM jsonb_populate_record(NULL::${table},${quote(JSON.stringify(row))}::jsonb) r) WHERE t.id='${uuid(row.id)}'`);}};
async function csv(client,params){const response=await fetch(apiBase+'/api/admin/students/export/?'+new URLSearchParams(params),{headers:{Origin:new URL(apiBase).origin,'X-UASSpain-Window-Id':client.windowId,Cookie:Object.entries(client.cookies).map(([k,v])=>`${k}=${v}`).join('; ')}});return {status:response.status,text:await response.text()};}
const owned=()=>fixtures.map(f=>quote(uuid(f.id))).join(',');
try {
  administrator=await adminClient();rootId=uuid((await administrator.call('/api/auth/me/')).body.id);
  gate(decrypt(sql(`SELECT email FROM accounts_userprofile WHERE id='${rootId}'`))==='e2e-admin@test.local','root_is_only_the_known_synthetic_administrator');
  rootProfile=JSON.parse(sql(`SELECT to_jsonb(p) FROM accounts_userprofile p WHERE id='${rootId}'`));
  rootSessions=JSON.parse(sql(`SELECT COALESCE(jsonb_agg(to_jsonb(s)),'[]'::jsonb) FROM auth_tab_session s WHERE profile_id='${rootId}' AND id IN (${[...initialSessions].map(quote).join(',')||'NULL'})`));
  gate(rootSessions.every(s=>s.profile_id===rootId&&initialSessions.has(s.id)),'preexisting_synthetic_root_sessions_have_exact_restoration_snapshots');
  otherProfilesBaseline=sql(`SELECT md5(COALESCE(jsonb_agg(to_jsonb(p) ORDER BY id)::text,'')) FROM accounts_userprofile p WHERE id<>'${rootId}'`);
  rootLogs=JSON.parse(sql(`SELECT COALESCE(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM conexiones_registroconexion r WHERE profile_id='${rootId}' AND id IN (${[...initialLogs].map(quote).join(',')||'NULL'})`));
  rootResets=JSON.parse(sql(`SELECT COALESCE(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM accounts_passwordresettoken r WHERE user_id=${Number(rootProfile.user_id)}`));
  const rootLifecycle=sql(`SELECT count(*) FROM account_lifecycle WHERE profile_id='${rootId}'`);gate(rootLifecycle==='0','fixture_root_has_no_existing_lifecycle_to_overwrite');
  for(const role of ['alumno','instructor','admin','admin']){
    const f=await registerFixture('TEMP Lifecycle');fixtures.push({...f,role});report.profiles.push({id:f.id,userId:f.userId,role,email:f.email});
    gate((await apiClient().call('/api/auth/verify-otp/','POST',{email:f.email,code:f.code})).status===200,'registration_identity_verified');
    gate((await administrator.call(`/api/profiles/${f.id}/`,'PATCH',{status:'activo',role,roles:[role],nombre:'TEMP '+f.id.slice(0,8),apellidos:'Muñoz'})).status===200,'synthetic_role_activated');
  }
  const [student,instructor,a,b]=fixtures;
  let s=await login(student),sibling=await login(student),i=await login(instructor),ac=await login(a),bc=await login(b);
  gate((await apiClient().call('/api/admin/students/')).status===401,'directory_requires_authentication');
  gate((await i.call('/api/admin/students/')).status===403,'directory_requires_administrator');
  gate((await s.call(`/api/admin/students/${student.id}/`)).status===403,'student_cannot_read_administrative_details');
  gate((await s.call(`/api/admin/students/${student.id}/reactivate/`,'POST',{confirm:true,expected_revision:1})).status===403,'student_cannot_reactivate');
  const beforeNegative=sql(`SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY id)::text) FROM accounts_userprofile p WHERE id IN (${owned()})`);
  gate((await s.call('/api/account/deactivate/','POST',{confirmation:'DARME DE BAJA',current_password:student.password,request_id:randomUUID(),profile_id:instructor.id})).status===400,'foreign_identity_payload_rejected');
  gate((await s.call('/api/account/deactivate/','POST',{confirmation:'BAJA',current_password:student.password,request_id:randomUUID()})).status===400,'incorrect_confirmation_rejected');
  gate((await s.call('/api/account/deactivate/','POST',{confirmation:'DARME DE BAJA',current_password:'wrong-synthetic-proof',request_id:randomUUID()})).status===400,'fresh_identity_required');
  gate(sql(`SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY id)::text) FROM accounts_userprofile p WHERE id IN (${owned()})`)===beforeNegative,'negative_operations_preserve_all_fixture_profiles');
  gate((await administrator.call(`/api/profiles/${student.id}/`,'PATCH',{assigned_instructor_id:instructor.id,nombre:'=TEMP '+student.id.slice(0,8)})).status===200,'instructor_and_formula_fixture_registered');
  const course=await administrator.call('/api/admin/courses','POST',{name:'TEMP Lifecycle '+randomUUID(),description:'Synthetic preservation fixture',category:'other',modality:'online',duration:'1 hora',status:'upcoming'});gate(course.status===201,'real_isolated_course_created');courseId=uuid(course.body.id);report.data.push({kind:'course',id:courseId});
  gate((await administrator.call(`/api/admin/students/${student.id}/courses/`,'POST',{course_id:courseId,confirm:false})).status===400,'course_requires_explicit_confirmation');
  gate((await administrator.call(`/api/admin/students/${student.id}/courses/`,'POST',{course_id:courseId,confirm:true})).body.created===true,'student_course_persisted');
  gate((await administrator.call(`/api/admin/students/${student.id}/courses/`,'POST',{course_id:courseId,confirm:true})).body.created===false,'course_association_idempotent');
  const exam=await i.call('/api/examenes/','POST',{nombre:'TEMP lifecycle exam',categoria:'other',modalidad:'teorico',activo:true});gate(exam.status===201,'owned_exam_created_without_generating_questions');examId=uuid(exam.body.id);report.data.push({kind:'exam',id:examId});
  resultId=randomUUID();report.data.push({kind:'result',id:resultId});
  sql(`INSERT INTO examenes_resultadoexamen(id,created_date,updated_date,examen_nombre,categoria,modalidad,respuestas,aciertos,errores,nota,porcentaje,tiempo_empleado,aprobado,fecha,alumno_id,examen_id) VALUES('${resultId}',NOW(),NOW(),'TEMP lifecycle historical result','other','teorico','{}',1,0,10,100,10,true,NOW(),'${student.id}','${examId}')`);
  const material=await i.call('/api/materiales/','POST',{titulo:'TEMP lifecycle material',categoria:'other',tipo:'documento',activo:true,archivo_url:'https://example.invalid/fixture.pdf'});gate(material.status===201,'owned_material_created');materialId=uuid(material.body.id);report.data.push({kind:'material',id:materialId});
  completionId=randomUUID();report.data.push({kind:'material_completion',id:completionId});
  sql(`INSERT INTO materiales_materialcompletado(id,created_date,updated_date,material_titulo,categoria,completado,fecha_completado,progreso,alumno_id,material_id) VALUES('${completionId}',NOW(),NOW(),'TEMP lifecycle material','other',true,NOW(),100,'${student.id}','${materialId}')`);
  const academic=()=>sql(`SELECT jsonb_build_object('result',(SELECT to_jsonb(r) FROM examenes_resultadoexamen r WHERE id='${resultId}'),'material',(SELECT to_jsonb(m) FROM materiales_material m WHERE id='${materialId}'),'completion',(SELECT to_jsonb(c) FROM materiales_materialcompletado c WHERE id='${completionId}'),'course',(SELECT to_jsonb(c) FROM courses c WHERE id='${courseId}'),'registration',(SELECT to_jsonb(r) FROM student_course_registration r WHERE profile_id='${student.id}' AND course_id='${courseId}'),'exam',(SELECT to_jsonb(e) FROM examenes_examen e WHERE id='${examId}'))`);
  const academicBaseline=academic();
  let found=await list(administrator,{q:student.id});gate(found.status===200&&found.body.count===1&&found.body.results[0].id===student.id,'uuid_search_paginates_real_rows');
  found=await list(administrator,{q:student.id.slice(0,8)});gate(found.body.results.some(r=>r.id===student.id),'partial_uuid_search');
  found=await list(administrator,{q:'MUÑOZ',course:courseId,instructor:instructor.id});gate(found.body.count===1&&found.body.results[0].courses[0].id===courseId,'unicode_course_instructor_search');
  const first=await list(administrator,{group:'history',limit:'1',offset:'0'}),second=await list(administrator,{group:'history',limit:'1',offset:'1'});gate(first.body.results.length===1&&second.body.results.length===1&&first.body.results[0].id!==second.body.results[0].id,'server_pagination_has_no_duplicates');
  gate((await list(administrator,{sort:'forged SQL'})).status===400,'ordering_is_allowlisted');
  gate((await list(administrator,{q:'x'})).status===400,'bounded_search_validation');
  gate((await list(administrator,{registered_from:'2027-01-01',registered_to:'2020-01-01'})).status===400,'reversed_dates_rejected');
  const exported=await csv(administrator,{q:student.id});gate(exported.status===200&&exported.text.includes('"\'=TEMP '),'csv_formula_is_inert');
  gate((await csv(i,{q:student.id})).status===403,'csv_requires_administrator');
  const details=await administrator.call(`/api/admin/students/${student.id}/`);gate(details.status===200&&details.body.academic_summary.exams===1&&details.body.exam_results[0].grade===10,'details_use_persisted_academic_history');
  gate(details.body.last_access!==null,'last_access_comes_from_real_login_evidence');
  const chat=await connect(s,`/ws/chat/${student.id}/`),presence=await connect(s,'/ws/conexiones/');
  const message=await i.call('/api/mensajes/','POST',{alumno_id:student.id,contenido:'TEMP lifecycle owned message'});gate(message.status===201,'private_message_created');report.data.push({kind:'message',id:uuid(message.body.id)});
  for(let n=0;n<40&&!chat.messages.some(e=>e.type==='message');n++)await sleep(50);gate(chat.messages.some(e=>e.type==='message'),'real_wss_chat_delivery');
  const call=await i.call('/api/videollamadas/','POST',{alumno_id:student.id,estado:'activa'});gate(call.status===201,'owned_video_created');report.data.push({kind:'video',id:uuid(call.body.id)});
  const video=await connect(s,`/ws/videollamada/${call.body.id}/`);
  const beforeReset=new Set(mailFiles());
  gate((await apiClient().call('/api/auth/password-reset/','POST',{email:student.email})).status===200,'owned_password_reset_requested');
  const resetMessage=await readMail(student.email,beforeReset);
  const oldReset=resetPayload(resetMessage,'New9!'+randomUUID());
  gate((await administrator.call('/api/system/mail/')).body.config.verified_at===null,'unavailable_provider_fixture_has_no_verified_external_sender');
  unavailableModeId=initialMailMode[0]?.id||randomUUID();
  if(initialMailMode.length)sql(`UPDATE core_systemsetting SET value='{"api_exclusive":true}' WHERE id='${uuid(unavailableModeId)}' AND key='mail_mode'`);
  else sql(`INSERT INTO core_systemsetting(id,key,value,created_date,updated_date) VALUES('${unavailableModeId}','mail_mode','{"api_exclusive":true}',NOW(),NOW())`);
  const requestId=randomUUID();const responses=await Promise.all([deactivate(s,student,requestId),deactivate(sibling,student,requestId)]);
  gate(responses.some(r=>r.status===200&&r.body.deactivated)&&responses.every(r=>[200,401].includes(r.status)),'simultaneous_deactivation_is_idempotent');
  gate(sql(`SELECT count(*) FROM account_lifecycle_event WHERE profile_id='${student.id}' AND operation='deactivated' AND request_id='${requestId}'`)==='1','one_deactivation_event_for_one_request');
  gate(sql(`SELECT status='baja' AND otp_verified FROM accounts_userprofile WHERE id='${student.id}'`)==='t','baja_is_persisted_without_disabling_verification');
  for(let n=0;n<80&&sql(`SELECT count(*) FROM account_notice WHERE event_id='${responses.find(r=>r.status===200).body.event_id}' AND last_error='mail_not_configured_or_available' AND mail_id IS NULL`)!=='1';n++)await sleep(200);
  gate(sql(`SELECT count(*) FROM account_notice WHERE event_id='${responses.find(r=>r.status===200).body.event_id}' AND last_error='mail_not_configured_or_available' AND mail_id IS NULL`)==='1','baja_remains_effective_when_email_is_unavailable');
  if(initialMailMode.length)restoreRows('core_systemsetting',initialMailMode);else sql(`DELETE FROM core_systemsetting WHERE id='${uuid(unavailableModeId)}' AND key='mail_mode'`);
  unavailableModeId=undefined;
  sql(`UPDATE account_notice SET next_attempt_at=NOW() WHERE event_id='${responses.find(r=>r.status===200).body.event_id}'`);
  const time=Date.parse(sql(`SELECT deactivated_at FROM account_lifecycle WHERE profile_id='${student.id}'`));gate(Math.abs(time-Date.now())<30000,'deactivation_utc_is_real');
  gate((await s.call('/api/auth/me/')).status===401&&(await sibling.call('/api/auth/refresh/','POST',{})).status===401,'all_sessions_and_refresh_are_revoked');
  gate((await apiClient().call('/api/auth/login/','POST',{email:student.email,password:student.password})).status===401,'login_after_baja_denied');
  gate((await s.call('/api/materiales/')).status===401&&(await s.call('/api/examenes/')).status===401&&(await s.call('/api/videollamadas/')).status===401,'all_private_functions_reject_deactivated_account');
  for(let n=0;n<70&&(!chat.closed||!video.closed||!presence.closed);n++)await sleep(50);gate(chat.closed&&video.closed&&presence.closed,'already_open_wss_chat_video_presence_close');
  gate(sql(`SELECT estado FROM conexiones_videollamada WHERE id='${call.body.id}'`)==='finalizada','video_closed_without_deleting_history');
  gate(sql(`SELECT count(*) FROM conexiones_mensaje WHERE id='${message.body.id}'`)==='1','chat_evidence_retained');
  gate(academic()===academicBaseline,'courses_exams_grades_materials_and_relationships_unchanged');
  gate((await i.call('/api/profiles/?role=alumno')).body.every(r=>r.id!==student.id),'instructor_default_students_excludes_baja');
  gate((await i.call('/api/profiles/?role=alumno&status=baja')).body.some(r=>r.id===student.id),'instructor_can_read_explicit_history');
  const assigned=await i.call(`/api/profiles/${instructor.id}/assigned-alumnos/`);gate(assigned.status===200&&assigned.body.every(r=>r.id!==student.id),'real_assigned_students_api_excludes_baja');
  const active=await list(administrator,{group:'active',q:student.id}),deactivated=await list(administrator,{group:'deactivated',q:student.id});gate(active.body.count===0&&deactivated.body.count===1,'student_never_in_both_tables');
  gate(deactivated.body.results[0].deactivation_type==='voluntary','voluntary_baja_is_distinct_from_blocking');
  gate((await administrator.call(`/api/profiles/${student.id}/`,'PATCH',{status:'activo'})).status===400,'generic_profile_patch_cannot_reactivate');
  sql(`UPDATE auth_user SET is_active=false WHERE id=${student.userId}`);
  gate((await administrator.call(`/api/admin/students/${student.id}/reactivate/`,'POST',{confirm:true,expected_revision:revision(student.id)})).status===400,'security_hold_prevents_reactivation');
  sql(`UPDATE auth_user SET is_active=true WHERE id=${student.userId}`);
  gate((await administrator.call(`/api/admin/students/${student.id}/reactivate/`,'POST',{confirm:false,expected_revision:revision(student.id)})).status===400,'reactivation_requires_confirmation');
  const reactivated=await administrator.call(`/api/admin/students/${student.id}/reactivate/`,'POST',{confirm:true,expected_revision:revision(student.id)});gate(reactivated.status===200&&reactivated.body.new_authentication_required,'authorized_reactivation_same_identity');
  gate((await s.call('/api/auth/me/')).status===401,'old_sessions_are_not_restored');s=await login(student);
  gate((await apiClient().call('/api/auth/password-reset/confirm/','POST',oldReset)).status===400,'pre_baja_recovery_token_stays_revoked_after_reactivation');
  gate(academic()===academicBaseline,'academic_history_survives_reactivation');
  gate((await deactivate(s,student,requestId)).status===409,'old_operation_id_cannot_claim_a_new_baja');
  gate((await deactivate(i,instructor)).status===200,'instructor_voluntary_baja');
  gate(sql(`SELECT assigned_instructor_id FROM accounts_userprofile WHERE id='${student.id}'`)===instructor.id,'instructor_baja_never_reassigns_students');
  found=await list(administrator,{q:student.id});gate(found.body.assignment_reviews.some(r=>r.instructor_id===instructor.id&&r.dependent_students===1),'administrator_sees_real_assignment_review');
  gate((await administrator.call(`/api/admin/accounts/${instructor.id}/reactivate/`,'POST',{confirm:true,expected_revision:revision(instructor.id)})).status===200,'authorized_instructor_reactivation');
  gate((await administrator.call(`/api/profiles/${student.id}/`,'PATCH',{role:'instructor',roles:['instructor']})).status===200,'student_role_change_is_authorized');
  gate((await list(administrator,{group:'history',q:student.id})).body.count===1&&(await list(administrator,{group:'active',q:student.id})).body.count===0,'student_history_survives_role_change_without_false_active_membership');
  gate((await administrator.call(`/api/profiles/${student.id}/`,'PATCH',{role:'alumno',roles:['alumno']})).status===200,'student_role_restored_for_remaining_tests');
  // The bootstrap account is a known synthetic fixture, never a MAIN account.
  const root={id:rootId,password:process.env.E2E_ADMIN_PASSWORD||'E2eAdmin_2026!'}; // pragma: allowlist secret - isolated fixture
  gate((await deactivate(administrator,root)).status===200,'administrator_baja_allowed_with_other_operative_administrators');
  docker(['restart',backend]);
  let restored=false;for(let n=0;n<100;n++){try{if((await ac.call('/api/auth/me/')).status===200){restored=true;break;}}catch{}await sleep(100);}
  gate(restored&&sql(`SELECT status FROM accounts_userprofile WHERE id='${rootId}'`)==='baja','real_backend_restart_does_not_reactivate_bootstrap_account');
  const races=await Promise.all([deactivate(ac,a),deactivate(bc,b)]);gate(races.filter(r=>r.status===200).length===1&&races.filter(r=>r.status===400).length===1,'concurrent_administrator_bajas_preserve_the_last_administrator');
  const survivor=races[0].status===400?ac:bc,removed=races[0].status===200?a:b;
  const remaining=Number(sql("SELECT count(*) FROM accounts_userprofile p JOIN auth_user u ON u.id=p.user_id WHERE p.status='activo' AND p.otp_verified AND u.is_active AND (p.role='admin' OR p.roles ? 'admin')"));gate(remaining===1,'exactly_one_operative_administrator_remains');
  gate((await survivor.call('/api/account/deactivation/')).body.can_deactivate===false,'last_administrator_readonly_warning');
  gate((await survivor.call(`/api/admin/accounts/${removed.id}/reactivate/`,'POST',{confirm:true,expected_revision:revision(removed.id)})).status===200,'administrator_reactivation_authorized');
  gate((await survivor.call(`/api/admin/accounts/${rootId}/reactivate/`,'POST',{confirm:true,expected_revision:revision(rootId)})).status===200,'bootstrap_root_requires_explicit_reactivation');administrator=await adminClient();
  gate(sql("SELECT has_table_privilege('uasspain_app','account_lifecycle_event','UPDATE') OR has_table_privilege('uasspain_app','account_lifecycle_event','DELETE')")==='f','runtime_cannot_modify_or_delete_protected_history');
  for(let n=0;n<80&&sql(`SELECT count(*) FROM account_notice n LEFT JOIN mail_outbox o ON o.id=n.mail_id JOIN account_lifecycle_event e ON e.id=n.event_id WHERE e.profile_id IN (${owned()},'${rootId}') AND o.state IS DISTINCT FROM 'ACCEPTED'`)!=='0';n++)await sleep(200);
  gate(sql(`SELECT count(*) FROM account_notice n JOIN mail_outbox o ON o.id=n.mail_id JOIN account_lifecycle_event e ON e.id=n.event_id WHERE e.profile_id IN (${owned()},'${rootId}') AND o.state='ACCEPTED'`)==='8','all_eight_notifications_reach_only_the_isolated_sink');
  const latestHistory=(await administrator.call(`/api/admin/students/${student.id}/`)).body.history;gate(latestHistory.some(e=>e.operation==='deactivated')&&latestHistory.some(e=>e.operation==='reactivated')&&latestHistory.some(e=>e.operation==='roles_changed'),'protected_baja_reactivation_role_history_persists');
  for(let n=0;n<12;n++){const start=performance.now();const value=await list(administrator,{q:student.id,sort:n%2?'name':'newest'});gate(value.status===200,'measured_paginated_query_'+n);report.latencyMs.push(Number((performance.now()-start).toFixed(2)));}
  report.result='PASS';
}catch(error){report.result='FAIL';report.errors.push(error instanceof assert.AssertionError?error.message:'Lifecycle fixture failed; inspect the guarded stage');process.exitCode=1;}
finally {
  for(const socket of sockets)socket.terminate();
  try {
    if(unavailableModeId){if(initialMailMode.length)restoreRows('core_systemsetting',initialMailMode);else sql(`DELETE FROM core_systemsetting WHERE id='${uuid(unavailableModeId)}' AND key='mail_mode'`);}
    const events=sql('SELECT id FROM account_lifecycle_event').split('\n').filter(id=>id&&!initialEvents.has(id)).map(uuid);report.eventIds=events;
    const notices=events.length?JSON.parse(sql(`SELECT COALESCE(jsonb_agg(to_jsonb(n)),'[]'::jsonb) FROM account_notice n WHERE event_id IN (${events.map(quote).join(',')})`)):[];
    for(const row of notices)sql(`DELETE FROM account_notice WHERE event_id='${uuid(row.event_id)}'`);
    const queue=sql('SELECT id FROM mail_outbox').split('\n').filter(id=>id&&!initialQueue.has(id)).map(uuid);
    const noticeIds=new Set(notices.map(n=>n.mail_id).filter(Boolean));
    for(const id of queue){const row=JSON.parse(sql(`SELECT to_jsonb(o) FROM mail_outbox o WHERE id='${id}'`));const message=JSON.parse(decrypt(row.payload_ciphertext));assert.ok(noticeIds.has(id)||(row.message_type==='account_notice'&&events.some(event=>row.idempotency_key==='account-event:'+event))||fixtures.some(f=>f.id===row.validity.profile_id||f.email===message.to),'Queue ownership demonstrated');sql(`DELETE FROM mail_outbox WHERE id='${id}'`);}
    for(const path of mailFiles().filter(path=>!initialFiles.has(path))){assert.match(path,/^\/app\/backups\/e2e-mailbox\/[0-9a-f-]+\.enc$/);const message=JSON.parse(decrypt(docker(['exec',backend,'cat',path])));if(fixtures.some(f=>f.email===message.to)||message.to==='e2e-admin@test.local'&&message.subject.startsWith('Confirmación'))docker(['exec',backend,'rm','--',path]);}
    if(rootProfile){restoreRows('accounts_userprofile',[rootProfile]);restoreRows('auth_tab_session',rootSessions);restoreRows('conexiones_registroconexion',rootLogs);restoreRows('accounts_passwordresettoken',rootResets);sql(`DELETE FROM account_lifecycle WHERE profile_id='${rootId}'`);}
    if(completionId)sql(`DELETE FROM materiales_materialcompletado WHERE id='${uuid(completionId)}'`);
    if(resultId)sql(`DELETE FROM examenes_resultadoexamen WHERE id='${uuid(resultId)}'`);
    if(fixtures.length){sql(`DELETE FROM student_course_registration WHERE profile_id IN (${owned()})`);}
    if(materialId)sql(`DELETE FROM materiales_material WHERE id='${uuid(materialId)}'`);
    if(examId)sql(`DELETE FROM examenes_examen WHERE id='${uuid(examId)}'`);
    if(courseId)sql(`DELETE FROM courses WHERE id='${uuid(courseId)}'`);
    const ownedProfiles=fixtures.map(f=>f.id);
    const sessions=sql('SELECT id FROM auth_tab_session').split('\n').filter(id=>id&&!initialSessions.has(id)).map(uuid);
    const logs=sql('SELECT id FROM conexiones_registroconexion').split('\n').filter(id=>id&&!initialLogs.has(id)).map(uuid);
    for(const id of logs){const owner=sql(`SELECT profile_id FROM conexiones_registroconexion WHERE id='${id}'`);assert.ok(ownedProfiles.includes(owner)||owner===rootId);sql(`DELETE FROM conexiones_registroconexion WHERE id='${id}'`);}
    for(const id of sessions){const owner=sql(`SELECT profile_id FROM auth_tab_session WHERE id='${id}'`);assert.ok(ownedProfiles.includes(owner)||owner===rootId);sql(`DELETE FROM auth_tab_session WHERE id='${id}'`);}
    for(const f of fixtures){assert.ok(!initialIds.has(f.id));sql(`DELETE FROM accounts_userprofile WHERE id='${uuid(f.id)}' AND user_id=${Number(f.userId)}`);sql(`DELETE FROM auth_user WHERE id=${Number(f.userId)} AND NOT EXISTS(SELECT 1 FROM accounts_userprofile WHERE user_id=${Number(f.userId)})`);f.password='';}
    if(otherProfilesBaseline)assert.equal(sql(`SELECT md5(COALESCE(jsonb_agg(to_jsonb(p) ORDER BY id)::text,'')) FROM accounts_userprofile p WHERE id<>'${rootId}'`),otherProfilesBaseline,'Every preexisting non-root fixture profile remains byte-identical');
    if(rootSessions.length)assert.equal(sql(`SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY id),'[]'::jsonb)::text FROM auth_tab_session s WHERE id IN (${rootSessions.map(s=>quote(uuid(s.id))).join(',')})`),sql(`SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY id),'[]'::jsonb)::text FROM jsonb_populate_recordset(NULL::auth_tab_session,${quote(JSON.stringify(rootSessions))}::jsonb) s`),'Baseline synthetic root sessions are restored exactly');
    report.ownedProfileResidue=fixtures.length?Number(sql(`SELECT count(*) FROM accounts_userprofile WHERE id IN (${owned()})`)):0;
    report.ownedQueueResidue=queue.filter(id=>sql(`SELECT count(*) FROM mail_outbox WHERE id='${id}'`)!=='0').length;
    report.protectedEventsRetained=events.every(id=>sql(`SELECT EXISTS(SELECT 1 FROM account_lifecycle_event WHERE id='${id}')`)==='t');
    assert.equal(report.ownedProfileResidue,0);assert.equal(report.ownedQueueResidue,0);assert.equal(report.protectedEventsRetained,true);
  }catch{report.result='FAIL';report.errors.push('Exact fixture cleanup could not be fully verified');process.exitCode=1;}
  key.fill(0);writeFileSync(dir+'/api-result.json',JSON.stringify(report,null,2));
}
console.log(`ACCOUNT_LIFECYCLE=${report.result} GATES=${report.gates.length} MAIN_WRITES=0`);
if(report.errors.length)console.log(report.errors.join('; '));
