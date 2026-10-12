// Every credential, profile and write belongs to the guarded disposable stack.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { concurrentFixtures, loginFixture } from './concurrent-fixtures.mjs';
import { fixtureSessionId, sql, uuid, sleep } from './auth-fixtures.mjs';

const dir = process.env.ADMIN_PROTECTION_REPORT || '.run/admin-protection-20261012';
mkdirSync(dir, { recursive: true });
const beforeProfileIds = new Set(sql('SELECT id FROM accounts_userprofile').split('\n'));
const baseline = sql("SELECT md5(COALESCE(jsonb_agg(to_jsonb(p) ORDER BY id)::text,'')) FROM accounts_userprofile p");
const seed = await concurrentFixtures(8);
const ownedIds = sql('SELECT id FROM accounts_userprofile').split('\n').filter(id => !beforeProfileIds.has(id)).map(uuid);
const [self, other, instructor, student] = [0, 7, 1, 3].map(index => seed.fixtures[index]);
const clients = [];
const gates = [];
const gate = (name, ok) => { assert.ok(ok, name); gates.push(name); console.log('PASS | ' + name); };
const logId = (client, profile) => uuid(sql(`SELECT r.id FROM conexiones_registroconexion r JOIN auth_tab_session s ON r.session_id=s.session_key WHERE s.id='${fixtureSessionId(client.windowId, profile.id)}' AND r.profile_id='${uuid(profile.id)}'`));
const ids = ownedIds.map(id => `'${id}'`).join(',');
const userIds = sql(`SELECT user_id FROM accounts_userprofile WHERE id IN (${ids})`).split('\n').map(Number);

const snapshot = () => sql(`SELECT jsonb_build_object('profiles',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM accounts_userprofile p WHERE id IN ('${self.id}','${other.id}')),'users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM auth_user u WHERE id IN (SELECT user_id FROM accounts_userprofile WHERE id IN ('${self.id}','${other.id}'))),'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM auth_tab_session s WHERE profile_id IN (${ids})),'logs',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM conexiones_registroconexion r WHERE profile_id IN (${ids})))::text`);
let a, b, i, s, sibling, selfLog, otherLog, instructorLog, sockets = [];
let success = false;
try {
  for (const fixture of [self, other, instructor, student]) clients.push(await loginFixture(fixture));
  [a, b, i, s] = clients;
  sibling = await loginFixture(self);
  gate('multirole_administrator_can_select_instructor_panel', (await b.call('/api/auth/session-role/', 'POST', { role: 'instructor' })).status === 200);
  selfLog = logId(a, self); otherLog = logId(b, other); instructorLog = logId(i, instructor);
  const before = snapshot();
  for (const [name, target, log] of [['self', self, selfLog], ['other_multirole', other, otherLog]]) {
    for (const body of [{ status: 'bloqueado' }, { status: 'bloqueado', role: 'alumno', roles: ['alumno'] }]) {
      gate(name + '_administrator_block_denied', (await a.call(`/api/profiles/${target.id}/`, 'PATCH', body)).status === 403);
    }
    for (const body of [{ estado_sesion: 'finalizada' }, { estado_sesion: 'expirada' }, { estado_sesion: 'activa', ultima_actividad: new Date().toISOString() }, { estado_sesion: 'finalizada', rol: 'alumno', profile_id: instructor.id, session_id: 'forged' }]) {
      gate(name + '_administrator_session_patch_denied', (await a.call(`/api/registros-conexion/${log}/`, 'PATCH', body)).status === 403);
    }
    gate(name + '_administrator_bulk_denied', (await a.call('/api/registros-conexion/bulk/', 'PATCH', { items: [{ id: instructorLog, estado_sesion: 'finalizada' }, { id: log, estado_sesion: 'finalizada' }] })).status === 403);
    gate(name + '_details_available', (await a.call(`/api/registros-conexion/${log}/`)).status === 200);
  }
  gate('negative_requests_preserve_every_profile_session_log_and_account', snapshot() === before);
  const listed = (await a.call('/api/registros-conexion/')).body;
  gate('persisted_admin_roles_protect_both_accounts_independent_of_session_role', [selfLog, otherLog].every(id => listed.find(row => row.id === id)?.can_manage_session === false));
  gate('nonadmin_actions_remain_available', listed.find(row => row.id === instructorLog)?.can_manage_session === true);
  gate('instructor_cannot_force_admin_logout', (await i.call(`/api/registros-conexion/${selfLog}/`, 'PATCH', { estado_sesion: 'finalizada' })).status === 403);
  // A damaged/historical log cannot redirect the guard to a different account.
  sql(`UPDATE conexiones_registroconexion SET profile_id='${instructor.id}' WHERE id='${otherLog}'`);
  try {
    gate('session_owner_resolved_from_postgres_not_log_or_payload', (await a.call(`/api/registros-conexion/${otherLog}/`, 'PATCH', { estado_sesion: 'finalizada' })).status === 403);
    gate('mismatched_owner_actions_hidden', (await a.call(`/api/registros-conexion/${otherLog}/`)).body.can_manage_session === false);
  } finally { sql(`UPDATE conexiones_registroconexion SET profile_id='${other.id}' WHERE id='${otherLog}'`); }
  // The account still has ADMIN while using the instructor panel.
  gate('secondary_admin_grant_survives_rejected_manipulation', sql(`SELECT (roles ? 'admin') FROM accounts_userprofile WHERE id='${other.id}'`) === 't');
  if (process.env.E2E_API_BASE === 'https://localhost:8444') {
    const WS = createRequire(new URL('../../frontend/package.json', import.meta.url))('ws');
    const open = () => new Promise((resolve, reject) => {
      const ws = new WS(`wss://localhost:8444/ws/conexiones/?window_id=${a.windowId}`, { ca: readFileSync('.secrets/tls/ca.crt'), origin: 'https://localhost:8444', headers: { Cookie: Object.entries(a.cookies).map(([k, v]) => `${k}=${v}`).join('; ') } });
      sockets.push(ws); ws.once('open', () => resolve(ws)); ws.once('error', reject);
    });
    let ws = await open(); gate('authenticated_wss_connects', ws.readyState === 1);
    ws.close(); await sleep(150); ws = await open(); gate('authenticated_wss_reconnects', ws.readyState === 1);
    const delivered = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('No real connection notice')), 8000); ws.on('message', data => { const event = JSON.parse(String(data)); if (event.type === 'conexion' && event.action === 'update') { clearTimeout(timer); resolve(true); } }); });
    gate('instructor_session_force_logout_allowed', (await a.call(`/api/registros-conexion/${instructorLog}/`, 'PATCH', { estado_sesion: 'finalizada' })).status === 200);
    gate('force_logout_delivers_real_wss_notice', await delivered);
  } else {
    gate('instructor_session_force_logout_allowed', (await a.call(`/api/registros-conexion/${instructorLog}/`, 'PATCH', { estado_sesion: 'finalizada' })).status === 200);
  }
  gate('instructor_session_is_really_revoked', (await i.call('/api/auth/me/')).status === 401);
  gate('student_still_authenticated_after_other_session_close', (await s.call('/api/auth/me/')).status === 200);
  i = await loginFixture(instructor);
  gate('instructor_account_block_allowed', (await a.call(`/api/profiles/${instructor.id}/`, 'PATCH', { status: 'bloqueado' })).status === 200);
  gate('instructor_block_really_revokes_access', (await i.call('/api/auth/me/')).status === 401);
  const studentLog = logId(s, student);
  gate('student_bulk_force_logout_allowed', (await a.call('/api/registros-conexion/bulk/', 'PATCH', { items: [{ id: studentLog, estado_sesion: 'finalizada' }] })).status === 200);
  gate('student_forced_logout_really_revokes_access', (await s.call('/api/auth/me/')).status === 401);
  s = await loginFixture(student);
  gate('student_account_block_allowed', (await a.call(`/api/profiles/${student.id}/`, 'PATCH', { status: 'bloqueado' })).status === 200);
  gate('student_block_really_revokes_access', (await s.call('/api/auth/me/')).status === 401);
  gate('administrator_voluntary_logout_allowed', (await a.call('/api/auth/logout/', 'POST', {})).status === 200);
  gate('administrator_voluntary_logout_revokes_only_own_session', (await a.call('/api/auth/me/')).status === 401 && (await b.call('/api/auth/me/')).status === 200 && (await sibling.call('/api/auth/me/')).status === 200);
  success = true;
} finally {
  for (const ws of sockets) ws.close();
  // Capture exact owned IDs before ON DELETE SET NULL removes ownership links.
  const logIds = sql(`SELECT id FROM conexiones_registroconexion WHERE profile_id IN (${ids})`).split('\n').filter(Boolean).map(uuid);
  await seed.cleanup();
  if (logIds.length) sql(`DELETE FROM conexiones_registroconexion WHERE id IN (${logIds.map(id => `'${id}'`).join(',')})`);
  assert.ok(userIds.every(Number.isSafeInteger));
  sql(`DELETE FROM auth_user WHERE id IN (${userIds.join(',')}) AND NOT EXISTS(SELECT 1 FROM accounts_userprofile WHERE user_id=auth_user.id)`);
  const residue = Number(sql(`SELECT (SELECT count(*) FROM accounts_userprofile WHERE id IN (${ids}))+(SELECT count(*) FROM auth_tab_session WHERE profile_id IN (${ids}))`));
  gate('owned_fixture_profile_and_session_residue_zero', residue === 0);
  gate('unrelated_profiles_unchanged', sql(`SELECT md5(COALESCE(jsonb_agg(to_jsonb(p) ORDER BY id)::text,'')) FROM accounts_userprofile p WHERE id NOT IN (${ids})`) === baseline);
  writeFileSync(dir + '/api-protection.json', JSON.stringify({ time: new Date().toISOString(), origin: process.env.E2E_API_BASE || 'http://127.0.0.1:8010', scope: 'isolated PostgreSQL and synthetic profiles', result: success ? 'PASS' : 'FAIL', gates, profileIds: ownedIds, logIds, userIds, mainWrites: 0, residue }, null, 2));
}
