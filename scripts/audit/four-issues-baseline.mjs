import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {project,work,env,verifyLabIdentity,client,login,saveProtected,loadProtected,originalFingerprint} from './four-issues-lab-common.mjs';

verifyLabIdentity();
const fixtureFile=resolve(work,'actors.dpapi'),entropy='UASSpain|four-issues-20261117|actors|v1';
const fixture=existsSync(fixtureFile)?loadProtected(fixtureFile,entropy):{project,owner:'four-issues-20261117',suffix:randomBytes(5).toString('hex'),actors:[],publications:[],uploads:[]};
assert.equal(fixture.project,project);
const report={observed_at:new Date().toISOString(),scope:'Existing isolated lab with original pre-repair images; synthetic records only; desktop PDFs unmodified',checks:[],exam_previews:[],credential_output:false};
const save=()=>{saveProtected(fixtureFile,entropy,fixture);writeFileSync('docs/audits/evidence/2026-11-17-four-issues-baseline.json',JSON.stringify(report,null,2)+'\n');};
const check=(id,pass,observed={})=>{report.checks.push({id,status:pass?'PASS':'FAIL',observed});save();assert.ok(pass,id);};
const before=originalFingerprint();
const admin=client();await login(admin,'e2e-admin@test.local',env.CLOSURE_ADMIN_PASSWORD);
for(const name of ['oldTeacher','newTeacher','student','otherStudent']) {
  let actor=fixture.actors.find(a=>a.name===name);
  if(!actor) {
    actor={name,email:`four-${name.toLowerCase()}-${fixture.suffix}@test.local`,password:'Aa9!'+randomBytes(18).toString('hex'),nombre:`Audit1711 ${name}`,apellidos:'Synthetic',username:`four-${name.toLowerCase()}-${fixture.suffix}`};
    fixture.actors.push(actor);save();
    const created=await admin.call('/api/users/crear-instructor/','POST',actor);
    check('CREATE_SYNTHETIC_ACCOUNT:'+name,created.status===201,{http:created.status});
    actor.id=created.body.id;actor.role='instructor';save();
    if(name.includes('Student')||name==='student') {
      const changed=await admin.call(`/api/profiles/${actor.id}/`,'PATCH',{role:'alumno',roles:['alumno']});
      check('SYNTHETIC_STUDENT_ROLE:'+name,changed.status===200&&changed.body.role==='alumno',{http:changed.status});actor.role='alumno';save();
    }
  }
}
const actor=name=>fixture.actors.find(a=>a.name===name);
const oldTeacher=actor('oldTeacher'),newTeacher=actor('newTeacher'),student=actor('student'),otherStudent=actor('otherStudent');
const teacher=client(),fresh=client();await login(teacher,oldTeacher.email,oldTeacher.password);await login(fresh,newTeacher.email,newTeacher.password);
if(!fixture.assigned) {
  const empty=await fresh.call('/api/profiles/');check('NEW_INSTRUCTOR_WITHOUT_ASSIGNMENTS_HAS_ONLY_SELF',empty.status===200&&empty.body.length===1&&empty.body[0].id===newTeacher.id,{count:empty.body?.length});
  for(const [instructor,pupil] of [[oldTeacher,student],[newTeacher,otherStudent]])check('ASSIGN_SYNTHETIC_STUDENT:'+instructor.name,(await admin.call(`/api/profiles/${instructor.id}/assign-alumnos/`,'POST',{student_ids:[pupil.id]})).status===200);
  fixture.assigned=true;save();
}
for(const [instructor,session,pupil,foreign] of [[oldTeacher,teacher,student,otherStudent],[newTeacher,fresh,otherStudent,student]]) {
  const list=await session.call('/api/profiles/');check('SAME_AUTHORIZED_VISIBILITY:'+instructor.name,list.status===200&&list.body.some(p=>p.id===pupil.id)&&!list.body.some(p=>p.id===foreign.id),{http:list.status,assigned_student_visible:list.body?.some(p=>p.id===pupil.id),foreign_student_visible:list.body?.some(p=>p.id===foreign.id)});
  check('FOREIGN_PROFILE_DENIED:'+instructor.name,(await session.call(`/api/profiles/${foreign.id}/`)).status===403);
}
for(const [name,active,date] of [['published',true,'2026-11-16'],['private',false,'2026-11-16'],['future',true,'2099-01-01']]) {
  if(fixture.publications.some(p=>p.name===name))continue;
  const publication=await teacher.call('/api/publicaciones-boe/','POST',{titulo:`FOUR-${fixture.suffix} BOE ${name}`,resumen:'Publicación oficial sintética de ensayo',fecha_publicacion:date,url:'https://www.boe.es/diario_boe/',categoria:'STS',activo:active});
  check('CREATE_SYNTHETIC_BOE:'+name,publication.status===201,{http:publication.status});fixture.publications.push({name,id:publication.body.id,title:publication.body.titulo});save();
}
const publicBoe=await client().call('/api/public/publicaciones/');
report.old_public_api_exposes_future=publicBoe.body.some(p=>p.id===fixture.publications.find(p=>p.name==='future').id);
const pupil=client();await login(pupil,student.email,student.password);
const privateBoe=await pupil.call(`/api/publicaciones-boe/${fixture.publications.find(p=>p.name==='private').id}/`);
report.old_student_private_boe_http=privateBoe.status;
for(let index=1;index<=3;index++) {
  let uploaded=fixture.uploads.find(x=>x.index===index);
  if(!uploaded) {
    const file=readFileSync(resolve('C:/Users/migue/OneDrive/Desktop',`EXAMEN STS ${index}.pdf`));
    const form=new FormData();form.set('file',new Blob([file],{type:'application/pdf'}),`EXAMEN STS ${index}.pdf`);
    const result=await teacher.call('/api/uploads/','POST',form);
    check('UPLOAD_OWNER_STS:'+index,result.status===200||result.status===201,{http:result.status});
    uploaded={index,url:result.body.file_url??result.body.url??result.body.archivo_url};assert.ok(uploaded.url,'Upload URL missing');fixture.uploads.push(uploaded);save();
  }
  const preview=await teacher.call('/api/examenes/importar-pdf/','POST',{file_url:uploaded.url,categoria:'STS'});
  report.exam_previews.push({document:index,http:preview.status,valid:preview.body?.total_validas,errors:preview.body?.total_errores,code:preview.body?.code??null});save();
}
report.original_profiles_unchanged=before===originalFingerprint();
report.status='BASELINE_RECORDED_NOT_REPAIR_VALIDATION';save();console.log(JSON.stringify(report));
