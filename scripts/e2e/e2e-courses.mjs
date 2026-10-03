import { randomUUID } from 'node:crypto';
import { adminClient, apiClient, check, sql, uuid } from './auth-fixtures.mjs';
let passed = 0;
const gate = (condition, name) => { check(condition, name); passed++; console.log(`PASS | course_${name}`); };
const ids = [];
let admin;
try {
  admin = await adminClient();
  const suffix = randomUUID();
  const payload = { name: `  Curso seguro ${suffix}  `, description: '  Texto\0 seguro\nSegunda línea  ', modality: 'presencial', duration: '  3 semanas (24 horas)  ', status: 'upcoming', sections: [{ title: 'Tema B', body: 'Contenido B' }, { title: 'Tema A', body: 'Contenido A' }] };
  const created = await admin.call('/api/admin/courses', 'POST', payload);
  gate(created.status === 201, 'create');
  const course = created.body; const id = uuid(course.id); ids.push(id);
  gate(course.name === payload.name.trim() && course.description === 'Texto seguro\nSegunda línea' && course.duration === '3 semanas (24 horas)', 'trim_and_sanitize');
  const stored = JSON.parse(sql(`SELECT json_build_object('name',name,'description',description,'duration',duration,'modality',modality,'topics',(SELECT json_agg(json_build_object('title',title,'sort_order',sort_order) ORDER BY sort_order) FROM course_sections WHERE course_id='${id}')) FROM courses WHERE id='${id}'`));
  gate(stored.name === course.name && stored.modality === 'presencial' && JSON.stringify(stored.topics) === JSON.stringify([{title:'Tema B',sort_order:0},{title:'Tema A',sort_order:1}]), 'database_and_topic_order');
  gate((await apiClient().call(`/api/courses/${course.slug}`)).status === 404 && !(await apiClient().call('/api/courses')).body.some(item => item.id === id), 'upcoming_not_public');
  for (const [name, patch] of Object.entries({ empty_name: {name:'   '}, empty_description:{description:' \0 '}, modality:{modality:'hibrido'}, duration:{duration:'x'.repeat(121)}, duration_type:{duration:5}, status:{status:'draft'}, topic:{sections:[{title:'\0 '}]}, topics_type:{sections:{title:'bad'}} })) {
    gate((await admin.call(`/api/admin/courses/${id}`, 'PATCH', patch)).status === 400, `invalid_${name}_denied`);
  }
  const missingModality = { ...payload }; delete missingModality.modality;
  gate((await admin.call('/api/admin/courses', 'POST', missingModality)).status === 400, 'missing_modality_denied');
  const duplicate = await admin.call('/api/admin/courses', 'POST', payload);
  gate(duplicate.status === 201 && duplicate.body.slug !== course.slug && duplicate.body.slug.length <= 180, 'automatic_slug_collision');
  ids.push(uuid(duplicate.body.id));
  const foreignTopic = duplicate.body.sections[0];
  gate((await admin.call(`/api/admin/courses/${id}`, 'PATCH', { name: 'must roll back', sections: [{ id: foreignTopic.id, title:'foreign', body:'' }] })).status === 400, 'foreign_topic_denied');
  const after = (await admin.call('/api/admin/courses')).body.find(item => item.id === id);
  gate(after.name === course.name && after.sections.length === 2, 'invalid_topic_rolls_back_course');
  const owner = sql(`SELECT created_by::text FROM courses WHERE id='${id}'`);
  const injection = "'; DROP TABLE courses; --";
  const injected = await admin.call(`/api/admin/courses/${id}`, 'PATCH', {description:injection,id:randomUUID(),created_by:randomUUID(),role:'admin'});
  gate(injected.status === 200 && injected.body.id === id && sql(`SELECT created_by::text FROM courses WHERE id='${id}'`) === owner, 'mass_assignment_protected');
  gate(sql(`SELECT description FROM courses WHERE id='${id}'`) === injection && sql(`SELECT COUNT(*) FROM courses WHERE id='${id}'`) === '1', 'sql_injection_is_plain_text');
  const cookies = Object.entries(admin.cookies).map(([key,value])=>`${key}=${value}`).join('; ');
  const unsafeOrigin = await fetch(`http://127.0.0.1:8010/api/admin/courses/${id}`, {method:'PATCH',headers:{Origin:'https://untrusted.example.invalid','Content-Type':'application/json',Cookie:cookies,'X-UASSpain-Window-Id':admin.windowId},body:JSON.stringify({name:'cross origin'})});
  gate(unsafeOrigin.status === 403 && unsafeOrigin.headers.get('access-control-allow-origin') !== 'https://untrusted.example.invalid', 'csrf_and_cors_reject_foreign_origin');
  const foreignWindow = apiClient(randomUUID(), {...admin.cookies});
  gate((await foreignWindow.call(`/api/admin/courses/${id}`, 'PATCH', {name:'foreign window'})).status === 401, 'cookie_bound_to_authenticated_window');
  const malformedId = await admin.call('/api/admin/courses/not-a-uuid', 'PATCH', {name:'invalid id'});
  gate(malformedId.status === 400 && (await admin.call('/api/admin/courses')).body.find(item=>item.id===id).name === course.name, 'invalid_id_cannot_mutate_course');
  const updated = await admin.call(`/api/admin/courses/${id}`, 'PATCH', { name: `Nombre nuevo ${suffix}`, description:'<img src=x onerror=alert(1)>', modality:'online', duration:'40 horas', status:'published', sections:[{ id:course.sections[1].id, title:'Tema A editado', body:'Seguro' }] });
  gate(updated.status === 200 && updated.body.slug === course.slug && updated.body.modality === 'online' && updated.body.sections[0].id === course.sections[1].id && updated.body.sections[0].sort_order === 0, 'update_preserves_url_and_topic_identity');
  const publicCourse = await apiClient().call(`/api/courses/${course.slug}`);
  gate(publicCourse.status === 200 && publicCourse.body.sections.length === 1 && publicCourse.body.duration === '40 horas' && !('cover_image_path' in publicCourse.body) && !('created_by' in publicCourse.body), 'published_public_payload');
  const html = await fetch(`http://127.0.0.1:8010/api/public/seo/course-body/${course.slug}`);
  const markup = await html.text();
  gate(html.status === 200 && markup.includes('&lt;img') && !markup.includes('<img src=x') && markup.includes('Online') && markup.includes('40 horas'), 'server_course_body_escapes_untrusted_text');
  const anonymous = apiClient();
  gate((await anonymous.call('/api/admin/courses', 'POST', payload)).status === 401, 'anonymous_write_denied');
  for (const [role,email,password] of [['instructor','instructor.e2e@test.local','E2eInstr_2026!'],['alumno','alumno.e2e@test.local','E2ePass_2026!']]) { // pragma: allowlist secret - isolated fixtures
    const client = apiClient();
    gate((await client.call('/api/auth/login/', 'POST', {email,password})).status === 200, `${role}_login`);
    const statuses = await Promise.all([client.call('/api/admin/courses','POST',payload),client.call(`/api/admin/courses/${id}`,'PATCH',{name:'unauthorized'}),client.call(`/api/admin/courses/${id}`,'DELETE')]);
    gate(statuses.every(result=>result.status===403), `${role}_writes_denied`);
  }
  gate((await admin.call(`/api/admin/courses/${id}`, 'PATCH', {status:'upcoming'})).status === 200 && (await anonymous.call(`/api/courses/${course.slug}`)).status === 404, 'unpublish_hides_url');
  gate((await admin.call(`/api/admin/courses/${id}`, 'DELETE')).status === 204 && sql(`SELECT COUNT(*) FROM course_sections WHERE course_id='${id}'`) === '0', 'delete_cascades_topics');
} finally {
  if (admin) for (const id of ids) await admin.call(`/api/admin/courses/${id}`, 'DELETE');
}
console.log(`COURSES_API_E2E=${passed} PASS`);
