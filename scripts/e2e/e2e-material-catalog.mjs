import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {adminClient, apiClient, uuid} from './auth-fixtures.mjs';

// auth-fixtures verifies isolated container labels and database identity before
// any request. Credentials arrive only through the caller's private environment.
const origin=process.env.E2E_API_BASE || 'http://127.0.0.1:8010';
const actors=JSON.parse(process.env.E2E_MATERIALS_ACTORS || '[]');
const documents=JSON.parse(process.env.E2E_MATERIALS_DOCUMENTS || '[]');
const output=resolve(process.env.E2E_MATERIALS_REPORT || '.run/material-catalog.json');
assert.equal(actors.length,3,'One synthetic instructor and two synthetic students required');
assert.equal(documents.length,4,'One synthetic document per course category required');
const report={scope:'isolated synthetic materials only',suffix:randomUUID(),checks:[],resources:[],status:'RUNNING'};
const save=()=>writeFileSync(output,JSON.stringify(report,null,2));
const gate=(id,condition)=>{report.checks.push({id,status:condition?'PASS':'FAIL'});save();assert.ok(condition,id);};
const denied=r=>[403,404].includes(r.status);
const metadataOnly=m=>m?.bloqueado===true && Object.keys(m).every(k=>['id','titulo','categoria','tipo','orden','activo','bloqueado'].includes(k));
const clients=[];
const materialIds=[];
try {
  const admin=await adminClient();
  for(const actor of actors){
    const client=apiClient();
    await client.call('/api/auth/context/','POST',{});
    gate('login_'+actor.role+'_'+clients.length,(await client.call('/api/auth/login/','POST',{email:actor.email,password:actor.password})).status===200);
    const me=await client.call('/api/auth/me/');
    gate('identity_'+clients.length,me.body.id===actor.id&&me.body.role===actor.role);
    clients.push(client);
  }
  const [teacher,student,other]=clients;
  async function create(document,label,active=true){
    const bytes=readFileSync(document.path),form=new FormData();
    form.append('file',new Blob([bytes],{type:document.mime}),`MAT-${report.suffix}-${label}.${document.extension}`);
    const uploaded=await fetch(origin+'/api/uploads/',{method:'POST',headers:{Origin:origin,'X-UASSpain-Window-Id':teacher.windowId,Cookie:Object.entries(teacher.cookies).map(([k,v])=>k+'='+v).join('; ')},body:form});
    gate('upload_'+label,uploaded.status===201);
    const meta=await uploaded.json(),url=new URL(meta.file_url,origin);
    assert.equal(url.origin,origin,'Never send fixture credentials to a different origin');
    assert.match(url.pathname,/^\/api\/media\/uploads\/[a-f0-9]{32}\.(pdf|docx|doc)$/);
    const response=await teacher.call('/api/materiales/','POST',{titulo:`Materiales ${document.category} ${label} Synthetic`,categoria:document.category,tipo:document.extension,activo:active,archivo_url:meta.file_url,archivo_path:meta.path,archivo_content_type:meta.content_type,archivo_nombre_original:`material.${document.extension}`,archivo_sha256:meta.sha256,archivo_tamano:bytes.length});
    gate('create_'+label,response.status===201);
    const item={id:uuid(response.body.id),path:url.pathname,category:document.category,label,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,mime:document.mime};
    materialIds.push(item.id);report.resources.push(item);save();return item;
  }
  async function permission(item,permitido,studentId=actors[1].id){
    const result=await admin.call('/api/permisos-acceso-material/','POST',{alumno_id:studentId,material_id:item.id,categoria:item.category,permitido,motivo:'Synthetic materials regression '+report.suffix});
    gate('permission_'+item.label+'_'+permitido,result.status===201);return result.body.id;
  }
  async function download(client,item){
    const response=await fetch(origin+item.path,{headers:{Origin:origin,'X-UASSpain-Window-Id':client.windowId,Cookie:Object.entries(client.cookies).map(([k,v])=>k+'='+v).join('; ')}});
    return {status:response.status,bytes:Buffer.from(await response.arrayBuffer()),mime:response.headers.get('content-type')};
  }
  const unlocked=[],locked=[];
  for(const [i,document] of documents.entries()){
    const allowed=await create(document,'desbloqueado-'+i);await permission(allowed,true);unlocked.push(allowed);
    const blocked=await create(document,'bloqueado-'+i);await permission(blocked,false);locked.push(blocked);
  }
  const unassigned=await create(documents[0],'publicado-sin-asignacion');
  const inactive=await create(documents[0],'no-publicado',false);await permission(inactive,true);
  await permission(unlocked[0],true,actors[2].id);
  const list=await student.call('/api/materiales/');gate('catalog_http',list.status===200);
  for(const item of unlocked){
    const listed=list.body.find(m=>m.id===item.id);
    gate('unlocked_visible_'+item.category,!!listed&&listed.bloqueado!==true&&listed.categoria===item.category&&!!listed.archivo_url);
    const file=await download(student,item);
    gate('unlocked_bytes_'+item.category,file.status===200&&file.bytes.length===item.bytes&&createHash('sha256').update(file.bytes).digest('hex')===item.sha256&&file.mime?.startsWith(item.mime));
    gate('unlocked_detail_'+item.category,(await student.call(`/api/materiales/${item.id}/`)).status===200);
  }
  for(const item of locked){
    gate('locked_metadata_'+item.category,metadataOnly(list.body.find(m=>m.id===item.id)));
    gate('locked_download_'+item.category,(await download(student,item)).status===404);
    gate('locked_detail_'+item.category,(await student.call(`/api/materiales/${item.id}/`)).status===404);
    gate('locked_extract_'+item.category,(await student.call(`/api/materiales/${item.id}/contenido/`)).status===403);
    gate('locked_completion_'+item.category,denied(await student.call('/api/materiales-completados/','POST',{material_id:item.id,completado:true})));
  }
  gate('published_without_assignment_visible_locked',metadataOnly(list.body.find(m=>m.id===unassigned.id)));
  gate('unassigned_detail_denied',(await student.call(`/api/materiales/${unassigned.id}/`)).status===404);
  gate('unassigned_download_denied',(await download(student,unassigned)).status===404);
  gate('unassigned_completion_denied',denied(await student.call('/api/materiales-completados/','POST',{material_id:unassigned.id,completado:true})));
  for(const item of [inactive]){
    gate('private_hidden_'+item.label,!list.body.some(m=>m.id===item.id));
    gate('private_detail_'+item.label,(await student.call(`/api/materiales/${item.id}/`)).status===404);
    gate('private_download_'+item.label,(await download(student,item)).status===404);
  }
  gate('foreign_assignment_still_hidden',!(await other.call('/api/materiales/')).body.some(m=>materialIds.includes(m.id)));
  gate('foreign_direct_denied',(await download(other,unlocked[0])).status===404);
  const forgedQuery=await student.call('/api/materiales/?alumno_id='+actors[2].id);
  gate('query_cannot_impersonate_another_student',JSON.stringify(forgedQuery.body)===JSON.stringify(list.body));
  gate('student_cannot_grant_access',(await student.call('/api/permisos-acceso-material/','POST',{alumno_id:actors[1].id,material_id:locked[0].id,permitido:true})).status===403);
  gate('anonymous_catalog_denied',(await apiClient().call('/api/materiales/')).status===401);
  const categoryDeny=await admin.call('/api/permisos-acceso-material/','POST',{alumno_id:actors[1].id,categoria:'A2',permitido:false});
  gate('category_deny_created',categoryDeny.status===201);
  gate('category_deny_overrides_individual_grant',metadataOnly((await student.call('/api/materiales/')).body.find(m=>m.id===unlocked[1].id))&&(await download(student,unlocked[1])).status===404);
  gate('category_deny_restored_without_delete',(await admin.call(`/api/permisos-acceso-material/${categoryDeny.body.id}/`,'PATCH',{permitido:true})).status===200);
  gate('specific_deny_overrides_category_grant',metadataOnly((await student.call('/api/materiales/')).body.find(m=>m.id===locked[1].id))&&(await download(student,locked[1])).status===404);
  gate('category_grant_restores_download',(await download(student,unlocked[1])).status===200);
  const counts=await student.call('/api/dashboard/counts/');
  gate('dashboard_counts_only_unlocked',counts.body.materials===(await student.call('/api/materiales/')).body.filter(m=>!m.bloqueado).length);
  report.status='PASS';
} catch(error){report.status='FAIL';report.error=String(error.message).slice(0,300);process.exitCode=1;}
finally {report.completed=new Date().toISOString();report.retainedSyntheticData=true;save();console.log(JSON.stringify({status:report.status,checks:report.checks.length,fail:report.checks.filter(c=>c.status==='FAIL').map(c=>c.id),report:output}));}
