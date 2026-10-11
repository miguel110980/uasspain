// Isolated content fixtures only; auth-fixtures enforces project/database/origin.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { adminClient, apiClient, sql, backend, sleep } from './auth-fixtures.mjs';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const WebSocket=require('ws');
const origin=process.env.E2E_API_BASE||'http://127.0.0.1:8010';
const allowedOrigin=process.env.E2E_API_BASE?new URL(origin).origin:'http://localhost:8010';
const dir=process.env.CONTENT_AUDIT_DIR||'.run/content-management-20261011';
const admin=await adminClient();const instructor=apiClient();const student=apiClient();const anonymous=apiClient();
assert.equal((await instructor.call('/api/auth/login/','POST',{email:'instructor.e2e@test.local',password:'E2eInstr_2026!'})).status,200); // pragma: allowlist secret - isolated fixture
assert.equal((await student.call('/api/auth/login/','POST',{email:'alumno.e2e@test.local',password:'E2ePass_2026!'})).status,200); // pragma: allowlist secret - isolated fixture
const gates=[];const ids={services:[],posts:[],courses:[]};const paths=[];const sockets=[];
const resourceIds=[];
const gate=(name,condition)=>{assert.ok(condition,name);gates.push(name);console.log('PASS | '+name);};
const root=kind=>'/api/admin/'+(kind==='posts'?'blog/posts':kind);
const get=async(kind,id)=>(await admin.call(root(kind))).body.find(item=>item.id===id);
const update=async(kind,id,payload,version)=>(await admin.call(root(kind)+'/'+id,'PATCH',payload,{'If-Match':String(version??(await get(kind,id)).version)}));
const create=async(kind,input)=>{const result=await admin.call(root(kind),'POST',input);assert.equal(result.status,201);ids[kind].push(result.body.id);return result.body;};
// Earlier browser cases retain their deleted-slug tombstones by design.
// The original active seven still require exact content and byte-for-byte integrity.
const baseline=sql("SELECT jsonb_agg(to_jsonb(s) ORDER BY sort_order,id) FROM services s WHERE status <> 'deleted'");
async function upload(client,id,bytes,name,mime,version){
 const data=new FormData();data.append('file',new Blob([bytes],{type:mime}),name);
 const result=await fetch(origin+'/api/admin/services/'+id+'/image',{method:'POST',headers:{Origin:allowedOrigin,'X-UASSpain-Window-Id':client.windowId,Cookie:Object.entries(client.cookies).map(([k,v])=>`${k}=${v}`).join('; '),'If-Match':String(version)},body:data});
 return {status:result.status,body:await result.json()};
}
function openSocket(headers={Origin:allowedOrigin}){
 const ws=new WebSocket(origin.replace(/^http/,'ws')+'/ws/public-content/',{headers});const events=[];sockets.push(ws);ws.on('message',raw=>events.push(JSON.parse(raw.toString())));
 return new Promise((resolve,reject)=>{ws.once('open',()=>resolve({ws,events}));ws.once('error',reject);});
}
async function wait(predicate){for(let i=0;i<80;i++){if(predicate())return;await sleep(100);}throw Error('Content notice timeout');}
async function expectEvent(observer,kind,revision){await wait(()=>observer.events.some(e=>e.type==='content_changed'&&e.kind===kind&&BigInt(e.revision)>=BigInt(revision)));}
const original=JSON.parse(baseline);let observer;let completed=false;
try{
 gate('services_original_seven_published',original.length===7&&original.every((s,i)=>s.status==='published'&&s.sort_order===i&&s.presentation.layout.length>0&&s.description.length>0));
 gate('services_original_import_ids_unique',new Set(original.map(s=>s.id)).size===7&&new Set(original.map(s=>s.slug)).size===7);
 const publicList=await anonymous.call('/api/services');gate('public_services_exclude_private_fields',publicList.status===200&&publicList.body.length===7&&publicList.body.every(s=>!('created_by' in s)&&!('image_path' in s)&&!('presentation' in s)));
 for(const service of original){const detail=await anonymous.call('/api/services/'+service.slug);assert.deepEqual(detail.body.presentation,service.presentation);gate('preserve_original_'+service.slug,detail.status===200&&detail.body.title===service.title&&detail.body.description===service.description&&detail.body.seo.title===service.seo.title);}
 observer=await openSocket();await wait(()=>observer.events.some(e=>e.type==='content_snapshot'));
 gate('public_socket_snapshot_contains_only_versions',observer.events[0].type==='content_snapshot'&&Object.keys(observer.events[0].versions).sort().join(',')==='courses,posts,services'&&Object.values(observer.events[0].versions).every(v=>typeof v==='string'));
 const suffix=randomUUID().replaceAll('-','');const draft=await create('services',{title:'TEMP Service '+suffix,slug:'temp-service-'+suffix,short_description:'TEMP synthetic summary',description:'TEMP synthetic full description',status:'draft',sort_order:100001});
 const second=await create('services',{title:'TEMP Second '+suffix,slug:'temp-second-'+suffix,status:'draft',sort_order:100002});
 gate('draft_service_private',!(await anonymous.call('/api/services')).body.some(s=>s.id===draft.id)&&(await anonymous.call('/api/services/'+draft.slug)).status===404);
 for(const [label,client,status] of [['instructor',instructor,403],['student',student,403],['anonymous',anonymous,401]]){
  gate(label+'_service_read_admin_denied',(await client.call('/api/admin/services')).status===status);
  gate(label+'_service_create_denied',(await client.call('/api/admin/services','POST',{title:'denied',slug:'denied'})).status===status);
  gate(label+'_service_edit_denied',(await client.call('/api/admin/services/'+draft.id,'PATCH',{title:'denied'},{'If-Match':'1'})).status===status);
  gate(label+'_service_delete_denied',(await client.call('/api/admin/services/'+draft.id,'DELETE',undefined,{'If-Match':'1'})).status===status);
 }
 gate('service_duplicate_slug_conflict',(await admin.call('/api/admin/services','POST',{title:'Duplicate',slug:draft.slug})).status===409);
 gate('service_requires_expected_version',(await admin.call('/api/admin/services/'+draft.id,'PATCH',{title:'stale'})).status===409);
 for(const payload of [{action_href:'javascript:alert(1)'},{image_url:'//external.invalid/a.png'},{presentation:{layout:[{tag:'script',props:{},children:['alert(1)']}]}},{icon:'Unknown'}])gate('reject_unsafe_service_input_'+Object.keys(payload)[0],(await update('services',draft.id,payload)).status===400);
 const committed=await update('services',draft.id,{status:'published'});gate('service_publish_committed',committed.status===200&&committed.body.version===2);
 const versions=(await anonymous.call('/api/public/content/versions/')).body;await expectEvent(observer,'services',versions.services);
 gate('service_realtime_delivered_after_commit',(await anonymous.call('/api/services')).body.some(s=>s.id===draft.id));
 const contenders=await Promise.all(['A','B'].map(title=>update('services',draft.id,{title:'TEMP concurrent '+title},2)));
 gate('service_simultaneous_edit_conflict',contenders.map(r=>r.status).sort().join(',')==='200,409');
 gate('service_stale_edit_preserves_winner',(await update('services',draft.id,{title:'TEMP stale'},2)).status===409&&['TEMP concurrent A','TEMP concurrent B'].includes((await get('services',draft.id)).title));
 const revBefore=(await anonymous.call('/api/public/content/versions/')).body.services;sql(`BEGIN; UPDATE services SET title='TEMP rolled back' WHERE id='${draft.id}'; ROLLBACK;`);
 gate('rollback_does_not_advance_revision',(await anonymous.call('/api/public/content/versions/')).body.services===revBefore&&(await get('services',draft.id)).title!=='TEMP rolled back');
 let a=await get('services',draft.id),b=await get('services',second.id);
 const staleOrder=await admin.call('/api/admin/content/services/order','POST',[{id:a.id,version:a.version,sort_order:100002},{id:b.id,version:999999,sort_order:100001}]);
 gate('reorder_conflict_rolls_back_all',staleOrder.status===409&&(await get('services',a.id)).sort_order===100001);
 const reordered=await admin.call('/api/admin/content/services/order','POST',[{id:a.id,version:a.version,sort_order:100002},{id:b.id,version:b.version,sort_order:100001}]);gate('service_atomic_reorder',reordered.status===204&&(await get('services',a.id)).sort_order===100002&&(await get('services',b.id)).sort_order===100001);
 const post=await create('posts',{title:'TEMP Post '+suffix,body:'TEMP synthetic publication',status:'draft'});
 const course=await create('courses',{name:'TEMP Course '+suffix,slug:'temp-course-'+suffix,category:'other',modality:'online',description:'TEMP synthetic programme',status:'draft',sections:[{title:'TEMP section',body:'TEMP topic'}]});
 gate('draft_post_course_private',!(await anonymous.call('/api/blog/posts')).body.some(p=>p.id===post.id)&&(await anonymous.call('/api/courses/'+course.slug)).status===404);
 for(const [kind,item,path] of [['posts',post,'/api/blog/posts'],['courses',course,'/api/courses']]){
  let current=await get(kind,item.id);const publish=await update(kind,item.id,{status:'published'},current.version);gate(kind+'_publish',publish.status===200);
  const version=(await anonymous.call('/api/public/content/versions/')).body[kind];await expectEvent(observer,kind,version);gate(kind+'_redis_realtime_delivery',(await anonymous.call(path)).body.some(p=>p.id===item.id));
  current=await get(kind,item.id);const changed=await update(kind,item.id,kind==='posts'?{body:'TEMP updated body'}:{description:'TEMP updated programme'},current.version);gate(kind+'_edit_advances_version',changed.status===200&&changed.body.version>current.version);
  gate(kind+'_stale_edit_denied',(await update(kind,item.id,{status:'draft'},current.version)).status===409);
  const foreign=await instructor.call(root(kind)+'/'+item.id,'PATCH',{status:'draft'},{'If-Match':String(changed.body.version)});gate(kind+'_instructor_mutation_denied',foreign.status===403);
  const hide=await update(kind,item.id,{status:'draft'},changed.body.version);gate(kind+'_unpublish_hides_public',hide.status===200&&!(await anonymous.call(path)).body.some(p=>p.id===item.id));
 }
 observer.ws.close();await sleep(100);const changed=await update('services',draft.id,{description:'TEMP missed change'});assert.equal(changed.status,200);
 const recovered=await openSocket();await wait(()=>recovered.events.some(e=>e.type==='content_snapshot'));
 gate('reconnect_snapshot_recovers_missed_changes',recovered.events[0].versions.services===(await anonymous.call('/api/public/content/versions/')).body.services);
 for(const event of [...observer.events,...recovered.events]){const keys=Object.keys(event).sort().join(',');assert.ok(keys==='type,versions'||keys==='kind,revision,type');}
 gate('public_events_do_not_leak_drafts_or_identities',true);
 const beforeResources=Number(sql('SELECT COUNT(*) FROM content_image_resources'));
 const invalidImage=await upload(admin,draft.id,Buffer.from('not an image'),'fake.png','image/png',(await get('services',draft.id)).version);
 gate('image_magic_and_decoder_reject_fake_upload',invalidImage.status===400&&Number(sql('SELECT COUNT(*) FROM content_image_resources'))===beforeResources);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
 gate('image_upload_requires_admin',(await upload(instructor,draft.id,png,'pixel.png','image/png',(await get('services',draft.id)).version)).status===403);
 const image=await upload(admin,draft.id,png,'pixel.png','image/png',(await get('services',draft.id)).version);
 if(image.status===200){paths.push(image.body.image_path);resourceIds.push(image.body.image_resource_id);}
 gate('image_upload_stored_and_registered',image.status===200&&image.body.image_resource_id&&Number(sql(`SELECT size_bytes FROM content_image_resources WHERE id='${image.body.image_resource_id}'`))===png.length);
 gate('image_resource_picker_lists_verified_image',(await admin.call('/api/admin/content/images')).body.some(r=>r.id===image.body.image_resource_id&&r.url===image.body.image_url));
 gate('resource_picker_requires_admin',(await instructor.call('/api/admin/content/images')).status===403);
 gate('image_reuse_has_foreign_key',(await update('services',second.id,{image_url:image.body.image_url})).body.image_resource_id===image.body.image_resource_id);
 gate('unknown_media_resource_rejected',(await update('services',second.id,{image_url:'/media/services/nonexistent.png'})).status===400);
 const deletion=await admin.call('/api/admin/services/'+draft.id,'DELETE',undefined,{'If-Match':String((await get('services',draft.id)).version)});gate('service_delete_hides_admin_public',deletion.status===204&&!(await admin.call('/api/admin/services')).body.some(s=>s.id===draft.id)&&(await anonymous.call('/api/services/'+draft.slug)).status===404);
 gate('reused_image_survives_original_service_removal',(await fetch(origin+image.body.image_url)).status===200);
 gate('deleted_service_retains_tombstone',sql(`SELECT status FROM services WHERE id='${draft.id}'`)==='deleted');
 gate('deleted_slug_cannot_be_recreated',(await admin.call('/api/admin/services','POST',{title:'TEMP resurrection',slug:draft.slug})).status===409);
 gate('original_services_untouched',sql("SELECT jsonb_agg(to_jsonb(s) ORDER BY sort_order,id) FROM services s WHERE id IN ("+original.map(s=>"'"+s.id+"'").join(',')+")")===baseline);
 completed=true;
}finally{
 sockets.forEach(s=>s.close());
 // Only exact UUIDs returned from this run's successful create endpoints.
 for(const [kind,table] of [['posts','blog_posts'],['courses','courses'],['services','services']])for(const id of ids[kind]){assert.match(id,/^[a-f0-9-]{36}$/);sql(`DELETE FROM ${table} WHERE id='${id}'`);}
 const all=Object.values(ids).flat();for(const id of all)sql(`DELETE FROM content_outbox WHERE entity_id='${id}'`);
 for(const id of resourceIds){assert.match(id,/^[a-f0-9-]{36}$/);sql(`DELETE FROM content_image_resources WHERE id='${id}'`);}
 for(const path of paths){assert.match(path,/^services\/service_[a-f0-9]{32}\.(png|jpg|jpeg|webp|gif)$/);execFileSync('docker',['exec',backend,'rm','-f','--','/app/media/'+path],{stdio:['pipe','pipe','pipe']});}
 const residue=Object.entries(ids).reduce((n,[kind,values])=>n+values.reduce((total,id)=>total+Number(sql(`SELECT COUNT(*) FROM ${kind==='posts'?'blog_posts':kind} WHERE id='${id}'`)),0),0);
 gate('content_fixture_residue_zero',residue===0);
 writeFileSync(dir+'/content-api.json',JSON.stringify({time:new Date().toISOString(),origin,scope:'Isolated Docker PostgreSQL/Redis and synthetic users/content; no MAIN writes',gates,ids,paths,resourceIds,mainWrites:0,residue,result:completed&&residue===0?'PASS':'NOT_COMPLETE'},null,2));
}
