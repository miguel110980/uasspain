import { randomBytes, randomUUID } from 'node:crypto';
import { adminClient, apiClient, check, registerFixture, sql, uuid } from './auth-fixtures.mjs';

let passed = 0;
const gate = (condition, name) => { check(condition, name); passed++; console.log(`PASS | assignment_${name}`); };
const fixtures = [];
let admin;
try {
  admin = await adminClient();
  const owner = (await admin.call('/api/profiles/')).body.find(profile => profile.email === 'instructor.e2e@test.local');
  check(Boolean(owner), 'Existing isolated instructor');
  const teacher = apiClient();
  check((await teacher.call('/api/auth/login/', 'POST', { email: owner.email, password: 'E2eInstr_2026!' })).status === 200, 'Fixture instructor login'); // pragma: allowlist secret - isolated fixture
  const recipients = [];
  for (let index = 0; index < 2; index++) {
    const suffix = randomUUID();
    const password = `Aa9!${randomBytes(18).toString('hex')}`;
    const created = await admin.call('/api/users/crear-instructor/', 'POST', { nombre: owner.nombre, apellidos: owner.apellidos,
      email: `assignment-${suffix}@test.local`, username: `assignment-${suffix}`, dni_nie: `ASG-${suffix}`,
      fecha_nacimiento: '1990-01-01', password, es_admin: index === 1 });
    check(created.status === 201, 'Assignment recipient fixture');
    fixtures.push(uuid(created.body.id));
    const client = apiClient();
    check((await client.call('/api/auth/login/', 'POST', { email: created.body.email, password, session_role: 'instructor' })).status === 200, 'Recipient fixture login');
    recipients.push({ ...created.body, client });
  }
  const students = [];
  for (let index = 0; index < 3; index++) {
    const student = await registerFixture(`Assignment ${index}`); fixtures.push(student.id);
    const client = apiClient();
    check((await client.call('/api/auth/verify-otp/', 'POST', { email: student.email, code: student.code })).status === 200, 'Student fixture verification');
    check((await admin.call(`/api/profiles/${student.id}/`, 'PATCH', { status: 'activo', assigned_instructor_id: owner.id })).status === 200, 'Student fixture activation and assignment');
    check((await client.call('/api/auth/login/', 'POST', { email: student.email, password: student.password })).status === 200, 'Student fixture login');
    students.push({ ...student, client });
  }
  const assign = (actor, recipient, ids) => actor.call(`/api/profiles/${recipient}/assign-alumnos/`, 'POST', { student_ids: ids });
  const directory = await teacher.call('/api/profiles/instructores/');
  gate(directory.status === 200 && recipients.every(recipient => directory.body.some(row => row.id === recipient.id)), 'directory_includes_active_multirole_instructors');
  gate(directory.body.every(row => Object.keys(row).sort().join(',') === 'apellidos,id,nombre,username'), 'directory_does_not_expose_sensitive_profile_fields');
  gate(directory.body.filter(row => row.nombre === owner.nombre && row.apellidos === owner.apellidos).length >= 3 && new Set(directory.body.map(row => row.username)).size === directory.body.length, 'duplicate_names_have_distinct_usernames');
  gate((await apiClient().call('/api/profiles/instructores/')).status === 401 && (await students[0].client.call('/api/profiles/instructores/')).status === 403, 'directory_denies_anonymous_and_students');
  gate((await assign(students[0].client, owner.id, [students[0].id])).status === 403, 'student_cannot_assign');
  gate((await assign(apiClient(), owner.id, [students[0].id])).status === 401, 'anonymous_cannot_assign');
  gate((await assign(teacher, owner.id, [])).status === 400 && (await assign(teacher, owner.id, [students[0].id, students[0].id])).status === 400, 'empty_and_duplicate_batch_rejected');
  gate((await assign(teacher, randomUUID(), [students[0].id])).status === 400 && (await assign(teacher, students[0].id, [students[1].id])).status === 400, 'missing_and_non_instructor_target_rejected');
  gate((await assign(teacher, owner.id, [randomUUID()])).status === 404, 'missing_student_rejected');
  gate((await assign(recipients[0].client, recipients[0].id, [students[0].id])).status === 403, 'foreign_student_cannot_be_claimed');
  const unavailable = recipients[1].id;
  for (const status of ['pendiente', 'bloqueado', 'rechazado']) {
    if (status === 'bloqueado') {
      // This candidate has both INSTRUCTOR and ADMIN. Blocking must now fail
      // without changing its current state or its assignment permissions.
      const before = sql(`SELECT to_jsonb(p)::text FROM accounts_userprofile p WHERE id='${uuid(unavailable)}'`);
      gate((await admin.call(`/api/profiles/${unavailable}/`, 'PATCH', { status })).status === 403
        && sql(`SELECT to_jsonb(p)::text FROM accounts_userprofile p WHERE id='${uuid(unavailable)}'`) === before,
      'multirole_administrator_block_denied_without_mutation');
      continue;
    }
    check((await admin.call(`/api/profiles/${unavailable}/`, 'PATCH', { status })).status === 200, 'Candidate fixture state');
    gate(!(await teacher.call('/api/profiles/instructores/')).body.some(row => row.id === unavailable) && (await assign(teacher, unavailable, [students[0].id])).status === 400, `${status}_instructor_not_assignable`);
  }
  check((await admin.call(`/api/profiles/${unavailable}/`, 'PATCH', { status: 'activo' })).status === 200, 'Restore candidate fixture');
  sql(`UPDATE accounts_userprofile SET otp_verified=false WHERE id='${uuid(unavailable)}'`);
  gate(!(await teacher.call('/api/profiles/instructores/')).body.some(row => row.id === unavailable) && (await assign(teacher, unavailable, [students[0].id])).status === 400, 'unverified_instructor_not_assignable');
  sql(`UPDATE accounts_userprofile SET otp_verified=true WHERE id='${uuid(unavailable)}'`);
  sql(`UPDATE auth_user SET is_active=false WHERE id=(SELECT user_id FROM accounts_userprofile WHERE id='${uuid(unavailable)}')`);
  gate(!(await teacher.call('/api/profiles/instructores/')).body.some(row => row.id === unavailable) && (await assign(teacher, unavailable, [students[0].id])).status === 400, 'inactive_auth_account_not_assignable');
  sql(`UPDATE auth_user SET is_active=true WHERE id=(SELECT user_id FROM accounts_userprofile WHERE id='${uuid(unavailable)}')`);
  check((await admin.call(`/api/profiles/${students[2].id}/`, 'PATCH', { roles: ['alumno', 'admin'] })).status === 200, 'Protected multirole fixture');
  gate((await assign(teacher, recipients[0].id, [students[2].id])).status === 403, 'instructor_cannot_transfer_privileged_student');
  check((await admin.call(`/api/profiles/${students[2].id}/`, 'PATCH', { roles: ['alumno'] })).status === 200, 'Restore ordinary student fixture');
  const transfer = await assign(teacher, recipients[0].id, [students[0].id]);
  gate(transfer.status === 200 && transfer.body.assigned_count === 1 && transfer.body.assigned_instructor_id === recipients[0].id && sql(`SELECT assigned_instructor_id FROM accounts_userprofile WHERE id='${students[0].id}'`) === recipients[0].id, 'owner_can_transfer_and_database_persists');
  gate(!(await teacher.call('/api/profiles/?role=alumno')).body.some(row => row.id === students[0].id) && (await teacher.call(`/api/profiles/${students[0].id}/`)).status === 403, 'former_instructor_loses_student_scope');
  const receiving = await recipients[0].client.call(`/api/profiles/${students[0].id}/`);
  gate(receiving.status === 200 && receiving.body.assigned_instructor_name === `${owner.nombre} ${owner.apellidos}`.trim() && (await recipients[0].client.call('/api/profiles/?role=alumno&status=activo')).body.some(row => row.id === students[0].id), 'recipient_directory_and_assigned_name_update');
  const me = await students[0].client.call('/api/auth/me/');
  gate(me.status === 200 && me.body.profile.assigned_instructor_id === recipients[0].id && me.body.profile.assigned_instructor_name === receiving.body.assigned_instructor_name, 'student_account_reflects_assignment');
  gate((await assign(teacher, recipients[0].id, [students[2].id, students[0].id])).status === 403 && sql(`SELECT assigned_instructor_id FROM accounts_userprofile WHERE id='${students[2].id}'`) === owner.id, 'batch_is_atomic_when_one_student_is_foreign');
  const concurrent = await Promise.all(recipients.map(recipient => assign(teacher, recipient.id, [students[1].id])));
  gate(concurrent.filter(result => result.status === 200).length === 1 && concurrent.filter(result => result.status === 403).length === 1 && recipients.some(recipient => sql(`SELECT assigned_instructor_id FROM accounts_userprofile WHERE id='${students[1].id}'`) === recipient.id), 'concurrent_transfer_rechecks_locked_ownership');
  gate((await teacher.call(`/api/profiles/${owner.id}/unassign-alumnos/`, 'POST', { student_ids: [students[2].id] })).status === 400 && sql(`SELECT assigned_instructor_id FROM accounts_userprofile WHERE id='${students[2].id}'`) === owner.id, 'existing_no_unassign_policy_preserved');
  gate((await assign(admin, owner.id, [students[0].id])).status === 200, 'administrator_can_reassign_across_instructors');
} finally {
  if (admin) for (const id of fixtures.reverse()) await admin.call(`/api/profiles/${id}/`, 'DELETE');
}
console.log(`ASSIGNMENTS_API_E2E=${passed} PASS`);
