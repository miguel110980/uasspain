import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {adminClient, apiClient, backend, registerFixture, sql, uuid} from './auth-fixtures.mjs';

// auth-fixtures refuses any database outside the disposable uasspain-e2e project.
const gates=[];
const gate=(condition,name)=>{assert.ok(condition,name);gates.push(name);};
const denied=response=>[400,403,404].includes(response.status);
const admin=await adminClient(), instructor=apiClient(), student=apiClient(), foreign=apiClient();
const profiles=[], exams=[], materials=[], archives=[], permissions=[], blocks=[];
const suffix=randomUUID();
const uploads=[];
async function create(client,path,payload,ledger){
  const response=await client.call(path,'POST',payload);
  assert.equal(response.status,201,`${path} create: ${JSON.stringify(response.body)}`);
  const id=uuid(response.body.id);ledger.push(id);return response.body;
}
try{
  gate((await instructor.call('/api/auth/login/','POST',{email:'instructor.e2e@test.local',password:'E2eInstr_2026!'})).status===200,'instructor_login'); // pragma: allowlist secret - isolated fixture
  gate((await student.call('/api/auth/login/','POST',{email:'alumno.e2e@test.local',password:'E2ePass_2026!'})).status===200,'student_login'); // pragma: allowlist secret - isolated fixture
  const teacherId=(await instructor.call('/api/auth/me/')).body.id;
  const pupilId=(await student.call('/api/auth/me/')).body.id;
  const otherTeacher=await registerFixture('TEMP access instructor');profiles.push(otherTeacher);
  const otherStudent=await registerFixture('TEMP access student');profiles.push(otherStudent);
  sql(`UPDATE accounts_userprofile SET role='instructor',roles='["instructor"]',status='activo',otp_verified=TRUE WHERE id='${uuid(otherTeacher.id)}'; UPDATE accounts_userprofile SET status='activo',otp_verified=TRUE,assigned_instructor_id='${uuid(otherTeacher.id)}' WHERE id='${uuid(otherStudent.id)}';`);
  gate((await foreign.call('/api/auth/login/','POST',{email:otherTeacher.email,password:otherTeacher.password})).status===200,'foreign_instructor_fixture_login');
  gate(sql(`SELECT assigned_instructor_id FROM accounts_userprofile WHERE id='${uuid(pupilId)}'`)===teacherId,'fixture_student_owned');
  const ownExam=await create(instructor,'/api/examenes/',{nombre:`TEMP own exam ${suffix}`,categoria:'A1/A3',descripcion:'Access regression',activo:true,num_preguntas:1},exams);
  const foreignExam=await create(foreign,'/api/examenes/',{nombre:`TEMP foreign exam ${suffix}`,categoria:'A1/A3',activo:true,num_preguntas:1},exams);
  const inactive=await create(instructor,'/api/examenes/',{nombre:`TEMP draft exam ${suffix}`,categoria:'A1/A3',activo:false,num_preguntas:1},exams);
  const question=await create(instructor,'/api/preguntas/',{examen_id:ownExam.id,enunciado:'Synthetic safe question',opcion_a:'Correct',opcion_b:'Other',respuesta_correcta:'a',orden:1},[]);
  const foreignQuestion=await create(foreign,'/api/preguntas/',{examen_id:foreignExam.id,enunciado:'Foreign synthetic question',opcion_a:'Correct',respuesta_correcta:'a',orden:1},[]);
  const form=new FormData();form.append('file',new Blob(['%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF'],{type:'application/pdf'}),'TEMP foreign.pdf');
  const uploaded=await fetch('http://127.0.0.1:8010/api/uploads/',{method:'POST',headers:{Origin:'http://localhost:8010','X-UASSpain-Window-Id':foreign.windowId,Cookie:Object.entries(foreign.cookies).map(([k,v])=>`${k}=${v}`).join('; ')},body:form});
  assert.equal(uploaded.status,201);const upload=await uploaded.json();const privatePath=upload.path;
  assert.match(privatePath,/^uploads\/[a-f0-9]{32}\.pdf$/);uploads.push(privatePath);
  const foreignMaterial=await create(foreign,'/api/materiales/',{titulo:`TEMP foreign material ${suffix}`,categoria:'A1/A3',tipo:'pdf',archivo_path:privatePath,archivo_url:'/api/media/'+privatePath,activo:true},materials);
  const ownMaterial=await create(instructor,'/api/materiales/',{titulo:`TEMP own material ${suffix}`,categoria:'A1/A3',tipo:'pdf',activo:true},materials);
  const foreignArchive=await create(foreign,'/api/archivos-examen/',{nombre_archivo:'TEMP foreign source.pdf',archivo_url:'/api/media/'+privatePath,categoria:'A1/A3'},archives);
  gate((await foreign.call('/api/media/'+privatePath)).status===200,'owner_can_download_exam_source');
  gate((await instructor.call('/api/media/'+privatePath)).status===404&&(await student.call('/api/media/'+privatePath)).status===404,'foreign_private_pdf_download_denied');
  gate((await instructor.call('/api/examenes/importar-pdf/','POST',{file_url:'/api/media/'+privatePath,categoria:'A1/A3'})).status===403,'foreign_private_pdf_import_denied');
  for(const client of [foreign,instructor])await create(client,'/api/materiales/',{titulo:'TEMP public reference '+suffix,categoria:'A1/A3',archivo_url:'https://example.org/shared-public.pdf'},materials);
  gate(true,'public_external_reference_can_be_shared');
  const inventory=(await instructor.call(`/api/instructor/access/${pupilId}/`)).body;
  gate(inventory.examenes.some(e=>e.id===ownExam.id)&&!inventory.examenes.some(e=>e.id===foreignExam.id),'inventory_scopes_resource_authors');
  gate(inventory.examenes.some(e=>e.id===inactive.id&&!e.activo&&!e.acceso),'draft_exam_inventory_disabled');
  gate(!(await student.call('/api/examenes/')).body.some(e=>[foreignExam.id,inactive.id].includes(e.id)),'student_excludes_foreign_and_draft_exams');
  gate(!(await student.call('/api/materiales/')).body.some(m=>m.id===foreignMaterial.id),'student_excludes_foreign_material');
  gate(denied(await instructor.call(`/api/instructor/access/${otherStudent.id}/`)),'foreign_student_inventory_denied');
  for(const [type,id] of [['examen',foreignExam.id],['material',foreignMaterial.id]]){
    gate(denied(await instructor.call('/api/instructor/access/toggle/','POST',{alumno_id:pupilId,type,item_id:id,acceso:true})),`foreign_${type}_assignment_denied`);
    gate(denied(await instructor.call('/api/instructor/access/toggle/','POST',{alumno_id:otherStudent.id,type,item_id:type==='examen'?ownExam.id:ownMaterial.id,acceso:false})),`foreign_student_${type}_mutation_denied`);
  }
  for(const [path,payload] of [[`/api/examenes/${foreignExam.id}/`,{nombre:'Unauthorized'}],[`/api/preguntas/${foreignQuestion.id}/`,{enunciado:'Unauthorized'}],[`/api/materiales/${foreignMaterial.id}/`,{titulo:'Unauthorized'}],[`/api/archivos-examen/${foreignArchive.id}/`,{descripcion:'Unauthorized'}]]){
    gate((await instructor.call(path)).status===404,'foreign_read_'+path);
    gate((await instructor.call(path,'PATCH',payload)).status===404,'foreign_update_'+path);
    gate((await instructor.call(path,'DELETE')).status===404,'foreign_delete_'+path);
  }
  gate(denied(await instructor.call('/api/permisos-acceso-material/','POST',{alumno_id:pupilId,material_id:foreignMaterial.id,permitido:true})),'legacy_material_grant_foreign_resource_denied');
  gate(denied(await instructor.call('/api/bloqueos-examen/','POST',{alumno_id:otherStudent.id,examen_id:ownExam.id,bloqueado:true})),'legacy_exam_block_foreign_student_denied');
  gate(denied(await instructor.call('/api/materiales/','POST',{titulo:'TEMP forged reference',categoria:'A1/A3',archivo_path:privatePath,archivo_url:'/api/media/'+privatePath})),'foreign_private_file_reference_cannot_be_forged');
  const toggle=async access=>instructor.call('/api/instructor/access/toggle/','POST',{alumno_id:pupilId,type:'examen',item_id:ownExam.id,acceso:access});
  gate((await toggle(false)).status===200,'exam_revoke_confirmed');
  gate((await student.call(`/api/examenes/${ownExam.id}/`)).status===404&&(await student.call(`/api/preguntas/?examen_id=${ownExam.id}`)).body.length===0,'revocation_covers_detail_and_questions');
  gate(denied(await student.call(`/api/examenes/${ownExam.id}/intentos/`,'POST',{modalidad:'libre'})),'revocation_blocks_attempt_start');
  gate((await toggle(true)).status===200&&(await student.call(`/api/examenes/${ownExam.id}/`)).status===200,'exam_grant_confirmed_by_student');
  const attempt=await student.call(`/api/examenes/${ownExam.id}/intentos/`,'POST',{modalidad:'libre'});
  gate(attempt.status===200&&attempt.body.preguntas.length===1&&!('respuesta_correcta' in attempt.body.preguntas[0]),'attempt_preserves_answer_secrecy');
  const result=await student.call('/api/resultados-examen/','POST',{examen_id:ownExam.id,attempt_id:attempt.body.id,modalidad:'libre',respuestas:{[question.id]:'a'}});
  gate(result.status===201&&result.body.aprobado,'real_exam_submission');
  const resultId=uuid(result.body.id), attemptId=uuid(attempt.body.id);
  const snapshot=sql(`SELECT row_to_json(r)::text FROM examenes_resultadoexamen r WHERE id='${resultId}'`);
  const attemptSnapshot=sql(`SELECT row_to_json(a)::text FROM examenes_intento a WHERE id='${attemptId}'`);
  await toggle(false);await toggle(true);
  gate(sql(`SELECT row_to_json(r)::text FROM examenes_resultadoexamen r WHERE id='${resultId}'`)===snapshot&&sql(`SELECT row_to_json(a)::text FROM examenes_intento a WHERE id='${attemptId}'`)===attemptSnapshot,'permission_changes_preserve_historical_result_and_attempt');
  gate((await student.call(`/api/resultados-examen/${resultId}/`)).status===200,'historical_result_stays_accessible');
  const individualBlocks=(await admin.call(`/api/bloqueos-examen/?examen_id=${ownExam.id}`)).body;
  gate(individualBlocks.length===1,'repeated_toggles_do_not_duplicate_permission_rows');
  for(const block of individualBlocks){blocks.push(uuid(block.id));assert.equal((await admin.call(`/api/bloqueos-examen/${block.id}/`,'DELETE')).status,204);}
  const old=await create(admin,'/api/bloqueos-examen/',{alumno_id:pupilId,examen_id:ownExam.id,bloqueado:true,fecha_fin:'2000-01-01T00:00:00Z'},blocks);
  gate((await student.call(`/api/examenes/${ownExam.id}/`)).status===200&&(await instructor.call(`/api/instructor/access/${pupilId}/`)).body.examenes.find(e=>e.id===ownExam.id).acceso,'expired_block_consistent');
  await admin.call(`/api/bloqueos-examen/${old.id}/`,'DELETE');
  const future=await create(admin,'/api/bloqueos-examen/',{alumno_id:pupilId,examen_id:ownExam.id,bloqueado:true,fecha_inicio:'2100-01-01T00:00:00Z'},blocks);
  gate((await student.call(`/api/examenes/${ownExam.id}/`)).status===200,'future_block_not_effective_yet');
  await admin.call(`/api/bloqueos-examen/${future.id}/`,'DELETE');
  const inherited=await create(admin,'/api/bloqueos-examen/',{alumno_id:pupilId,categoria:'A1/A3',bloqueado:true},blocks);
  const inheritedState=(await instructor.call(`/api/instructor/access/${pupilId}/`)).body.examenes.find(e=>e.id===ownExam.id);
  gate(inheritedState.heredado&&!inheritedState.acceso&&(await student.call(`/api/examenes/${ownExam.id}/`)).status===404,'category_deny_consistent');
  gate((await toggle(true)).status===400,'category_exam_deny_not_overridden');
  await admin.call(`/api/bloqueos-examen/${inherited.id}/`,'DELETE');
  const studentCounts=(await student.call('/api/dashboard/counts/')).body;
  gate(studentCounts.exams===(await student.call('/api/examenes/')).body.length&&studentCounts.materials===(await student.call('/api/materiales/')).body.filter(m=>!m.bloqueado).length,'student_counters_match_authorized_lists');
  const counts=(await instructor.call('/api/dashboard/counts/')).body;
  gate(counts.students===Number(sql(`SELECT count(*) FROM accounts_userprofile WHERE assigned_instructor_id='${uuid(teacherId)}' AND (role='alumno' OR roles ? 'alumno')`)),'instructor_total_matches_full_postgres_scope');
  gate((await foreign.call('/api/resultados-examen/delete-many/','POST',{query:{alumno_id:pupilId}})).body.deleted===0&&sql(`SELECT count(*) FROM examenes_resultadoexamen WHERE id='${resultId}'`)==='1','foreign_bulk_result_deletion_preserves_history');
  gate((await student.call('/api/instructor/access/toggle/','POST',{alumno_id:pupilId,type:'examen',item_id:ownExam.id,acceso:true})).status===403,'student_cannot_grant_self');
}finally{
  // Exact IDs created in this invocation only. The guarded project has no real users.
  for(const [path,ids] of [['/api/bloqueos-examen/',blocks],['/api/permisos-acceso-material/',permissions],['/api/archivos-examen/',archives],['/api/materiales/',materials],['/api/examenes/',exams]])
    for(const id of ids){const r=await admin.call(path+id+'/','DELETE');assert.ok([204,404].includes(r.status),`Exact fixture cleanup ${path}${id}`);}
  for(const p of profiles){const id=uuid(p.id);assert.equal(sql(`SELECT user_id FROM accounts_userprofile WHERE id='${id}'`),String(p.userId));sql(`DELETE FROM accounts_userprofile WHERE id='${id}'; DELETE FROM auth_user WHERE id=${Number(p.userId)};`);assert.equal(sql(`SELECT count(*) FROM accounts_userprofile WHERE id='${id}'`),'0');}
  for(const [table,ids] of [['materiales_material',materials],['examenes_examen',exams],['examenes_archivoexamen',archives]])
    for(const id of ids)assert.equal(sql(`SELECT count(*) FROM ${table} WHERE id='${uuid(id)}'`),'0');
  for(const path of uploads){
    assert.match(path,/^uploads\/[a-f0-9]{32}\.pdf$/);
    assert.equal(sql(`SELECT (SELECT count(*) FROM materiales_material WHERE archivo_path='${path}' OR archivo_url='/api/media/${path}')+(SELECT count(*) FROM examenes_archivoexamen WHERE archivo_path='${path}' OR archivo_url='/api/media/${path}')`),'0');
    execFileSync('docker',['exec',backend,'rm','--','/app/media/'+path],{stdio:['pipe','pipe','pipe']});
  }
}
console.log(JSON.stringify({scope:'isolated HTTP/API and PostgreSQL; exact fixture cleanup',gates,result:'PASS',count:gates.length}));
