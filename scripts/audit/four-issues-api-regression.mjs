import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {work,verifyLabIdentity,client,login,loadProtected,saveProtected,originalFingerprint,sql} from './four-issues-lab-common.mjs';

verifyLabIdentity();
const fixtureFile=resolve(work,'actors.dpapi'),entropy='UASSpain|four-issues-20261117|actors|v1';
const fixture=loadProtected(fixtureFile,entropy);
const report={observed_at:new Date().toISOString(),scope:'Candidate Docker API in existing isolated lab; original desktop PDFs plus synthetic rich-format documents; no original data writes',checks:[],desktop_documents:[],synthetic_documents:[],created_synthetic_exams:[]};
const save=()=>writeFileSync('docs/audits/evidence/2026-11-17-four-issues-api-regression.json',JSON.stringify(report,null,2)+'\n');
const gate=(id,pass,observed={})=>{report.checks.push({id,status:pass?'PASS':'FAIL',observed});save();assert.ok(pass,id);};
const protectedBefore=originalFingerprint();
const actors={};
for(const actor of fixture.actors){actors[actor.name]=client();await login(actors[actor.name],actor.email,actor.password);}
const teacher=actors.oldTeacher,student=actors.student;
const actor=name=>fixture.actors.find(a=>a.name===name);
for(const [name,own,foreign] of [['oldTeacher','student','otherStudent'],['newTeacher','otherStudent','student']]) {
  const list=await actors[name].call('/api/profiles/');
  gate('INSTRUCTOR_SCOPE:'+name,list.status===200&&list.body.some(p=>p.id===actor(own).id)&&!list.body.some(p=>p.id===actor(foreign).id));
  gate('INSTRUCTOR_IDOR:'+name,(await actors[name].call(`/api/profiles/${actor(foreign).id}/`)).status===403);
}
const boe=await client().call('/api/public/publicaciones/');
gate('PUBLIC_BOE_VISIBLE',boe.status===200&&boe.body.some(p=>p.id===fixture.publications.find(p=>p.name==='published').id));
for(const name of ['private','future']){
  const id=fixture.publications.find(p=>p.name===name).id;
  gate('PUBLIC_BOE_EXCLUDED:'+name,!boe.body.some(p=>p.id===id));
  gate('STUDENT_DIRECT_BOE_DENIED:'+name,(await student.call(`/api/publicaciones-boe/${id}/`)).status===404);
}
const studentBoe=await student.call('/api/publicaciones-boe/');
gate('STUDENT_BOE_LIST_HAS_NO_PRIVATE_OR_FUTURE',studentBoe.status===200&&!studentBoe.body.some(p=>fixture.publications.some(f=>f.name!=='published'&&f.id===p.id)));
const upload=async(file,name)=>{
  const type=name.endsWith('.pdf')?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const form=new FormData();form.set('file',new Blob([readFileSync(file)],{type}),name);
  const r=await teacher.call('/api/uploads/','POST',form);gate('UPLOAD:'+name,[200,201].includes(r.status),{http:r.status});
  const url=r.body.file_url??r.body.url??r.body.archivo_url;assert.ok(url);return url;
};
const counts=()=>sql("SELECT json_build_array((SELECT count(*) FROM examenes_examen),(SELECT count(*) FROM examenes_pregunta),(SELECT count(*) FROM examenes_archivoexamen))");
const canonical=text=>text.normalize('NFC').replace(/\s+/gu,' ').trim();
const reference=JSON.parse(readFileSync(resolve(work,'sts-independent-reference.json'),'utf8'));
for(let index=1;index<=3;index++) {
  const name=`EXAMEN STS ${index}.pdf`,url=await upload(resolve('C:/Users/migue/OneDrive/Desktop',name),name);
  fixture.uploads=fixture.uploads.filter(x=>x.index!==index);fixture.uploads.push({index,url});saveProtected(fixtureFile,entropy,fixture);
  const preview=await teacher.call('/api/examenes/importar-pdf/','POST',{file_url:url,categoria:'STS'});
  gate('STS_PREVIEW:'+index,preview.status===200,{http:preview.status,valid:preview.body?.total_validas,errors:preview.body?.total_errores});
  const expected=reference.find(x=>x.file===name),valid=expected.questions.filter(q=>q.answer);
  gate('STS_ALL_QUESTIONS_ACCOUNTED:'+index,preview.body.total_detectadas===40&&preview.body.total_validas===valid.length&&preview.body.total_errores===40-valid.length);
  for(const q of preview.body.preguntas??[]){
    const source=expected.questions.find(x=>x.number===q.numero);assert.ok(source);
    gate(`STS_QUESTION_CONTENT:${index}:${q.numero}`,canonical(q.enunciado)===canonical(source.statement)&&Object.keys(source.options).every(letter=>canonical(q.opciones[letter])===canonical(source.options[letter].text))&&q.respuesta_correcta===source.answer);
  }
  report.desktop_documents.push({file:name,sha256:expected.sha256,detected:preview.body.total_detectadas,valid:preview.body.total_validas,errors:preview.body.errores});save();
  const before=counts();
  if(index===3){
    const confirm=await teacher.call('/api/examenes/importar-pdf/','POST',{file_url:url,categoria:'STS',confirm:true,preview_token:preview.body.preview_token});
    gate('STS3_AMBIGUITY_IS_ATOMIC_REJECTION',confirm.status===400&&counts()===before,{http:confirm.status,counts_unchanged:counts()===before});
  }else{
    const invalid=await teacher.call('/api/examenes/importar-pdf/','POST',{file_url:url,categoria:'STS',confirm:true,preview_token:'invalid'});
    gate('PREVIEW_PROOF_REQUIRED:'+index,invalid.status===400&&counts()===before);
    const confirm=await teacher.call('/api/examenes/importar-pdf/','POST',{file_url:url,categoria:'STS',confirm:true,preview_token:preview.body.preview_token,metadata:{original_name:name,content_type:'application/pdf'}});
    gate('STS_CONFIRM_DRAFT:'+index,confirm.status===200&&confirm.body.examenes_creados?.length===1,{http:confirm.status});
    const id=confirm.body.examenes_creados[0].id;assert.match(id,/^[0-9a-f-]{36}$/);
    report.created_synthetic_exams.push(id);save();
    const stored=JSON.parse(sql(`SELECT json_build_object('active',e.activo,'questions',(SELECT count(*) FROM examenes_pregunta p WHERE p.examen_id=e.id)) FROM examenes_examen e WHERE e.id='${id}'`));
    gate('STS_PERSISTED_40_DRAFT_QUESTIONS:'+index,stored.active===false&&stored.questions===40);
    const after=counts();const duplicate=await teacher.call('/api/examenes/importar-pdf/','POST',{file_url:url,categoria:'STS',confirm:true,preview_token:preview.body.preview_token});
    gate('STS_NO_DUPLICATE_IMPORT:'+index,duplicate.status===400&&counts()===after);
  }
  gate('STUDENT_IMPORT_DENIED:'+index,[401,403].includes((await student.call('/api/examenes/importar-pdf/','POST',{file_url:url,categoria:'STS'})).status));
  gate('OTHER_INSTRUCTOR_FILE_IDOR_DENIED:'+index,[403,404].includes((await actors.newTeacher.call('/api/examenes/importar-pdf/','POST',{file_url:url,categoria:'STS'})).status));
}
for(const fixtureCase of JSON.parse(readFileSync(resolve(work,'synthetic-import-cases.json'),'utf8'))){
  const url=await upload(resolve(work,fixtureCase.file),fixtureCase.file);
  const preview=await teacher.call('/api/examenes/importar-pdf/','POST',{file_url:url,categoria:'STS'});
  gate('RICH_FORMAT:'+fixtureCase.file,preview.status===200&&(fixtureCase.valid?preview.body.total_validas===1&&preview.body.preguntas[0].respuesta_correcta===fixtureCase.answer:preview.body.total_validas===0&&preview.body.total_errores===1),{http:preview.status,valid:preview.body?.total_validas,errors:preview.body?.total_errores});
  report.synthetic_documents.push({file:fixtureCase.file,expected_valid:fixtureCase.valid,result:preview.body?.total_validas});save();
}
gate('ORIGINAL_PROFILES_CREDENTIALS_AND_ROLES_UNCHANGED',protectedBefore===originalFingerprint());
report.status='PASS_SCOPED_CANDIDATE_API_AND_IMPORT_REGRESSION';save();console.log(JSON.stringify({status:report.status,checks:report.checks.length,desktop_documents:report.desktop_documents,synthetic_documents:report.synthetic_documents}));
