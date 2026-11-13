import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {jsPDF} from '../../frontend/node_modules/jspdf/dist/jspdf.node.min.js';
// This suite can only write to the disposable project, never localhost:443.
const directory=resolve(process.env.STUDENT_AUDIT_DIR||'.run/alumno-audit-20261010');
const info=JSON.parse(execFileSync('docker',['inspect','uasspain-e2e-backend-e2e-1'],{encoding:'utf8',stdio:['pipe','pipe','pipe']}))[0];
assert.equal(info.Config.Labels['com.docker.compose.project'],'uasspain-e2e');
assert.ok(info.Config.Env.includes('DB_NAME=test_e2e_uasspain'));
process.env.E2E_FIELD_ENCRYPTION_KEY=info.Config.Env.find(v=>v.startsWith('FIELD_ENCRYPTION_KEY=')).slice('FIELD_ENCRYPTION_KEY='.length);
const {adminClient,apiClient,sql}=await import('./auth-fixtures.mjs');
const report={time:new Date().toISOString(),project:'uasspain-e2e',gates:[],requests:[],fixtures:[],extractions:[],blockedSources:[],mainWrites:0};
function gate(condition,name){assert.ok(condition,name);report.gates.push(name);}
async function call(client,path,method='GET',payload){const start=performance.now();const r=await client.call(path,method,payload);report.requests.push({timestampUtc:new Date().toISOString(),endpoint:path.split('?')[0],method,status:r.status,responseTimeMs:Math.round(performance.now()-start),correlationId:r.body?.correlation_id||null});return r;}
const admin=await adminClient();const teacher=apiClient(),student=apiClient(),other=apiClient();
for(const [client,email,password] of [[teacher,'instructor.e2e@test.local','E2eInstr_2026!'],[student,'alumno.e2e@test.local','E2ePass_2026!'],[other,'segundo.e2e@test.local','E2eSecond_2026!']])gate((await call(client,'/api/auth/login/','POST',{email,password})).status===200,'login_'+email);
const profiles=(await call(admin,'/api/profiles/')).body;
const pupil=profiles.find(p=>p.email==='alumno.e2e@test.local');const second=profiles.find(p=>p.email==='segundo.e2e@test.local');assert.ok(pupil&&second);
const suffix=randomUUID(),foreignPassword='Aa9!'+randomBytes(20).toString('hex');const foreign=await call(admin,'/api/users/crear-instructor/','POST',{nombre:'TEMP',apellidos:'Material scope',email:`material-scope-${suffix}@test.local`,username:`mat-${suffix}`,dni_nie:`MAT-${suffix}`,fecha_nacimiento:'1990-01-01',password:foreignPassword,es_admin:false});gate(foreign.status===201,'foreign_fixture_created');report.fixtures.push({type:'profile',id:foreign.body.id});
gate((await call(admin,`/api/profiles/${foreign.body.id}/assign-alumnos/`,'POST',{student_ids:[second.id]})).status===200,'foreign_student_assignment');
const foreignClient=apiClient();gate((await call(foreignClient,'/api/auth/login/','POST',{email:`material-scope-${suffix}@test.local`,password:foreignPassword})).status===200,'foreign_teacher_login');
async function material(bytes,title,category,legacy=false){
 const form=new FormData();form.append('file',new Blob([bytes],{type:'application/pdf'}),title+'.pdf');
 const upload=await fetch('http://127.0.0.1:8010/api/uploads/',{method:'POST',headers:{Origin:'http://localhost:8010','X-UASSpain-Window-Id':teacher.windowId,Cookie:Object.entries(teacher.cookies).map(([k,v])=>`${k}=${v}`).join('; ')},body:form});gate(upload.status===201,'upload_'+title);const meta=await upload.json();
 const r=await call(teacher,'/api/materiales/','POST',{titulo:title,categoria:category,tipo:'pdf',activo:true,archivo_url:meta.file_url,archivo_path:legacy?'':meta.path,archivo_nombre_original:title+'.pdf',archivo_sha256:meta.sha256,archivo_content_type:meta.content_type});gate(r.status===201,'material_'+title);
 report.fixtures.push({type:'material',id:r.body.id,storagePath:meta.path,sha256:meta.sha256});return {id:r.body.id,url:meta.file_url,sha256:meta.sha256};
}
async function download(client,path){const start=performance.now();const r=await fetch('http://127.0.0.1:8010'+path,{headers:{Origin:'http://localhost:8010','X-UASSpain-Window-Id':client.windowId,Cookie:Object.entries(client.cookies).map(([k,v])=>`${k}=${v}`).join('; ')}});const bytes=Buffer.from(await r.arrayBuffer());report.requests.push({timestampUtc:new Date().toISOString(),method:'GET',endpoint:path,status:r.status,responseTimeMs:Math.round(performance.now()-start)});return {status:r.status,bytes};}
mkdirSync(directory,{recursive:true});
try{
 const preflight=JSON.parse(readFileSync(resolve(directory,'material-preflight.json')));
 const oracle=JSON.parse(readFileSync(resolve(directory,'source-oracle-form-support.json')));
 const normalized=text=>text.normalize('NFKC').toLocaleLowerCase('es').replace(/[^\p{L}\p{N}]/gu,'');
 for(const source of preflight.files.filter(f=>f.localCopy)){
  const bytes=readFileSync(resolve(directory,source.localCopy));assert.equal(createHash('sha256').update(bytes).digest('hex'),source.sha256);
  const title='TEMP source '+source.id+' '+suffix;
  const item=await material(bytes,title,source.category,true);
  const extracted=await call(teacher,`/api/materiales/${item.id}/contenido/`);
  const known=oracle.sources.find(d=>d.sourceId===source.id);assert.ok(known);
   gate(extracted.status===200,'extract_real_source_'+source.id);
   gate(extracted.body.sha256===source.sha256&&extracted.body.paginas.length===known.pages.length&&extracted.body.bytes_texto>0,'source_hash_pages_text_'+source.id);
   gate(extracted.body.requiere_revision===true&&extracted.body.estructura_tablas_verificada===false,'no_unverified_semantic_quality_claim_'+source.id);
   const missing=[];
   let paragraphCount=0;
   for(const expected of known.pages){
    const actual=extracted.body.paginas[expected.page-1];
    assert.equal(actual.pagina,expected.page);
    assert.ok(!actual.texto.includes('\ufffd'),'Unicode replacement not allowed');
    const text=normalized(actual.texto);
    for(const [index,paragraph] of expected.paragraphs.entries()){
     paragraphCount++;
     if(!text.includes(normalized(paragraph)))missing.push({page:expected.page,paragraph:index});
    }
   }
   report.sourceCoverage??=[];
   report.sourceCoverage.push({sourceId:source.id,pages:known.pages.length,paragraphs:paragraphCount,missingParagraphs:missing,unicodeReplacementCharacters:0});
   gate(missing.length===0,'independent_source_paragraphs_complete_'+source.id+' '+JSON.stringify(missing));
   if(known.formObjects>0){
    gate(Number(extracted.body.objetos_form_procesados)>0,'embedded_form_operations_processed_'+source.id);
    const important=known.pages.find(p=>p.page===46);assert.ok(important?.tables.length);
    const actual=normalized(extracted.body.paginas[45].texto);
    // Select the real four-column matrix, excluding a layout detector's
    // two-column page-frame false positive. Presence does not certify geometry.
    const matrix=important.tables.find(t=>t.columns===4&&t.rows[0].slice(1).join('|')==='A1|A2|A3');assert.ok(matrix);
    const cells=matrix.rows.flat().filter(c=>c&&normalized(c));
    gate(cells.length>=24&&cells.every(c=>actual.includes(normalized(c))),'embedded_form_table_cells_complete_'+source.id);
    report.sourceCoverage.at(-1).importantTableCells=cells.length;
    report.sourceCoverage.at(-1).processedFormInvocations=extracted.body.objetos_form_procesados;
    report.sourceCoverage.at(-1).tableLayoutVerifiedByBackend=false;
   }
  const own=await download(student,item.url);gate(own.status===200&&createHash('sha256').update(own.bytes).digest('hex')===source.sha256,'authorized_private_pdf_'+source.id);
  gate((await download(other,item.url)).status===404,'foreign_student_download_denied_'+source.id);
  gate((await call(foreignClient,`/api/materiales/${item.id}/contenido/`)).status===404,'foreign_teacher_extraction_denied_'+source.id);
  gate((await call(student,`/api/materiales/${item.id}/contenido/`)).status===403,'student_cannot_use_staff_extraction_'+source.id);
  const permission=await call(teacher,'/api/permisos-acceso-material/','POST',{alumno_id:pupil.id,material_id:item.id,categoria:source.category,permitido:false});gate(permission.status===201,'revoke_material_'+source.id);
  gate((await download(student,item.url)).status===404,'revocation_protects_exact_download_'+source.id);
  const locked=(await call(student,'/api/materiales/')).body.find(m=>m.id===item.id);
  gate(locked?.bloqueado===true&&!('archivo_url' in locked)&&!('archivo_path' in locked)&&!('archivo_sha256' in locked),'revocation_lists_only_locked_metadata_'+source.id);
  gate((await call(teacher,`/api/permisos-acceso-material/${permission.body.id}/`,'DELETE')).status===204,'restore_fixture_grant_'+source.id);
  const raw=sql(`SELECT archivo_url,archivo_path FROM materiales_material WHERE id='${item.id}'::uuid`);gate(raw.includes(item.url)&&raw.endsWith('|'),'legacy_row_unchanged_by_extraction_'+source.id);
  if(extracted.status===200){
   writeFileSync(resolve(directory,'extracted-'+source.id+'.json'),JSON.stringify(extracted.body));
   report.extractions.push({sourceId:source.id,fixtureMaterialId:item.id,title,category:source.category,sha256:source.sha256,pages:extracted.body.paginas.length,textBytes:extracted.body.bytes_texto,emptyPages:extracted.body.paginas_sin_texto,requiresReview:true});
  }
 }
 const corrupt=await material(Buffer.from('%PDF-1.4\nnot a valid document'),'TEMP corrupt '+suffix,'A1/A3');gate((await call(teacher,`/api/materiales/${corrupt.id}/contenido/`)).status===400,'corrupt_pdf_explicit_error');
 const empty=await material(Buffer.from(new jsPDF().output('arraybuffer')),'TEMP empty '+suffix,'A1/A3');gate((await call(teacher,`/api/materiales/${empty.id}/contenido/`)).status===400,'no_text_pdf_requires_review_or_ocr');
 gate((await call(apiClient(),`/api/materiales/${empty.id}/contenido/`)).status===401,'anonymous_extraction_denied');
 report.result='PASS';console.log(JSON.stringify({result:report.result,gates:report.gates.length,realSourcePdfs:report.extractions.length,blockedIncompleteSources:report.blockedSources.length,requests:report.requests.length,mainWrites:0}));
}catch(error){report.result='FAIL';report.error=error.message;throw error;}finally{writeFileSync(resolve(directory,'phase02-api.json'),JSON.stringify(report,null,2));}
