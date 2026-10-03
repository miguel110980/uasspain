import { randomBytes, randomUUID } from 'node:crypto';
import { adminClient, apiClient, check, registerFixture, sql, uuid } from './auth-fixtures.mjs';

let passed = 0;
const gate = (condition, name) => { check(condition, name); passed++; console.log(`PASS | panels_${name}`); };
const fixtures = [];
let admin;
try {
  admin = await adminClient();
  const existing = await admin.call('/api/profiles/');
  const owner = existing.body.find(p => p.email === 'instructor.e2e@test.local');
  check(Boolean(owner), 'Existing isolated instructor');
  const teacherPassword = `Aa9!${randomBytes(18).toString('hex')}`;
  const suffix = randomUUID().replaceAll('-', '');
  const dniNumber = 10000000 + (randomBytes(4).readUInt32BE() % 90000000);
  const created = await admin.call('/api/users/crear-instructor/', 'POST', {
    nombre: 'Scoped', apellidos: 'Instructor', email: `scoped-${suffix}@test.local`,
    username: `scoped-${suffix}`, dni_nie: `${dniNumber}${'TRWAGMYFPDXBNJZSQVHLCKE'[dniNumber % 23]}`,
    fecha_nacimiento: '1990-01-01', password: teacherPassword, es_admin: false,
  });
  gate(created.status === 201, 'admin_creates_safe_instructor');
  const teacherId = uuid(created.body.id); fixtures.push(teacherId);
  const student = await registerFixture('Scoped student'); fixtures.push(student.id);
  const studentClient = apiClient();
  gate((await studentClient.call('/api/auth/verify-otp/', 'POST', { email: student.email, code: student.code })).status === 200, 'student_verifies_fixture_email');
  const activated = await admin.call(`/api/profiles/${student.id}/`, 'PATCH', { status: 'activo', assigned_instructor_id: teacherId });
  gate(activated.status === 200 && activated.body.assigned_instructor_id === teacherId, 'admin_assignment_changes_and_persists');
  gate(sql(`SELECT assigned_instructor_id FROM accounts_userprofile WHERE id='${student.id}'`) === teacherId, 'assignment_api_matches_database');
  const instructor = apiClient();
  gate((await instructor.call('/api/auth/login/', 'POST', { email: 'instructor.e2e@test.local', password: 'E2eInstr_2026!' })).status === 200, 'instructor_login'); // pragma: allowlist secret - isolated fixture
  gate((await instructor.call(`/api/profiles/${student.id}/`)).status === 403, 'foreign_student_detail_denied');
  gate((await instructor.call(`/api/profiles/${student.id}/`, 'PATCH', { nombre: 'unauthorized' })).status === 403, 'foreign_student_edit_denied');
  const scoped = await instructor.call('/api/profiles/?role=alumno&status=activo');
  gate(scoped.status === 200 && scoped.body.every(p => p.assigned_instructor_id === owner.id && p.id !== student.id), 'instructor_list_scope');
  const steal = await instructor.call(`/api/profiles/${owner.id}/assign-alumnos/`, 'POST', { student_ids: [student.id] });
  gate(steal.status === 403 && sql(`SELECT assigned_instructor_id FROM accounts_userprofile WHERE id='${student.id}'`) === teacherId, 'foreign_student_reassignment_denied');
  gate((await instructor.call(`/api/mensajes/?alumno_id=${student.id}`)).status === 403, 'foreign_chat_history_denied');
  gate((await instructor.call('/api/mensajes/', 'POST', { alumno_id: student.id, contenido: 'unauthorized fixture' })).status === 403, 'foreign_chat_send_denied');
  gate((await instructor.call('/api/videollamadas/', 'POST', { alumno_id: student.id, estado: 'activa' })).status === 403, 'foreign_video_creation_denied');
  gate((await studentClient.call('/api/auth/login/', 'POST', { email: student.email, password: student.password })).status === 200, 'student_login');
  const mass = await studentClient.call(`/api/profiles/${student.id}/`, 'PATCH', { role: 'admin', roles: ['admin'], assigned_instructor_id: owner.id });
  gate(mass.status === 200 && mass.body.role === 'alumno' && mass.body.roles.join(',') === 'alumno' && mass.body.assigned_instructor_id === teacherId, 'student_mass_assignment_does_not_escalate');
  gate((await studentClient.call(`/api/profiles/${teacherId}/assign-alumnos/`, 'POST', { student_ids: [student.id] })).status === 403, 'student_assignment_endpoint_denied');
  const logs = await admin.call(`/api/registros-conexion/?profile_id=${student.id}&limit=1`);
  gate(logs.status === 200 && logs.body.length === 1 && logs.body[0].profile_id === student.id, 'last_access_uses_requested_profile');
  const filtered = await admin.call(`/api/profiles/?role=alumno&status=activo&limit=1&offset=0`);
  const next = await admin.call(`/api/profiles/?role=alumno&status=activo&limit=1&offset=1`);
  gate(filtered.status === 200 && next.status === 200 && filtered.body[0].id !== next.body[0].id, 'profile_pagination_is_stable');
  const status = await admin.call('/api/system/status/');
  const expected = JSON.parse(sql(`SELECT json_build_object('total',(SELECT COUNT(*) FROM accounts_userprofile),'published_courses',(SELECT COUNT(*) FROM courses WHERE status='published'),'available_exams',(SELECT COUNT(*) FROM examenes_examen WHERE activo),'exam_results',(SELECT COUNT(*) FROM examenes_resultadoexamen),'passed_exams',(SELECT COUNT(*) FROM examenes_resultadoexamen WHERE aprobado))`));
  gate(status.status === 200 && status.body.users.total === expected.total && ['published_courses','available_exams','exam_results','passed_exams'].every(key => status.body.academic[key] === expected[key]), 'dashboard_aggregates_match_database');

  // A second student role must work independently of the primary staff role.
  const multirole = await admin.call(`/api/profiles/${student.id}/`, 'PATCH', { role: 'instructor', roles: ['instructor', 'alumno'] });
  gate(multirole.status === 200 && multirole.body.role === 'instructor', 'multirole_student_keeps_primary_staff_role');
  const teacher = apiClient();
  gate((await teacher.call('/api/auth/login/', 'POST', { email: created.body.email, password: teacherPassword })).status === 200, 'assigned_teacher_login');
  const assigned = await teacher.call(`/api/profiles/${teacherId}/assign-alumnos/`, 'POST', { student_ids: [student.id] });
  const directory = await teacher.call(`/api/profiles/${teacherId}/assigned-alumnos/`);
  gate(assigned.status === 200 && directory.status === 200 && directory.body.some(p => p.id === student.id), 'multirole_assignment_and_directory');
  gate((await teacher.call(`/api/instructor/access/${student.id}/`)).status === 200, 'multirole_academic_access');
  gate((await teacher.call('/api/resultados-practico/', 'POST', { alumno_id: student.id, categoria: 'a1a3', nota: 8 })).status === 201, 'multirole_practical_result');
  gate((await teacher.call('/api/videollamadas/', 'POST', { alumno_id: student.id, estado: 'activa' })).status === 201, 'multirole_student_video');
  gate((await teacher.call(`/api/profiles/${student.id}/`, 'DELETE')).status === 403, 'instructor_cannot_delete_staff_with_student_role');
  const privileged = await admin.call(`/api/profiles/${student.id}/`, 'PATCH', { role: 'alumno', roles: ['alumno', 'admin'] });
  gate(privileged.status === 200 && (await teacher.call(`/api/profiles/${student.id}/`, 'PATCH', { status: 'bloqueado' })).status === 403 && (await teacher.call(`/api/profiles/${student.id}/`, 'DELETE')).status === 403, 'primary_student_does_not_expose_secondary_admin_to_instructor_management');
  const staffOnly = await admin.call(`/api/profiles/${student.id}/`, 'PATCH', { role: 'instructor' });
  gate(staffOnly.status === 200 && staffOnly.body.roles.join(',') === 'instructor' && !staffOnly.body.assigned_instructor_id, 'removing_student_role_clears_academic_assignment');
  gate((await teacher.call(`/api/profiles/${student.id}/`)).status === 403 && !(await teacher.call('/api/profiles/')).body.some(profile => profile.id === student.id), 'former_teacher_cannot_read_demoted_staff_profile');
  const studentAgain = await admin.call(`/api/profiles/${student.id}/`, 'PATCH', { role: 'alumno', assigned_instructor_id: teacherId });
  gate(studentAgain.status === 200 && studentAgain.body.assigned_instructor_id === teacherId && studentAgain.body.roles.join(',') === 'alumno', 'role_and_assignment_change_is_atomic');
} finally {
  if (admin) for (const id of fixtures.reverse()) await admin.call(`/api/profiles/${id}/`, 'DELETE');
}
console.log(`PANELS_SCOPE_E2E=${passed}/29 PASS`);
