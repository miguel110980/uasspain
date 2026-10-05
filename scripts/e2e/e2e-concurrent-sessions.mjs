import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { apiClient, check, postgres, root, sleep, sql, uuid } from './auth-fixtures.mjs';
import { concurrentFixtures, loginFixture } from './concurrent-fixtures.mjs';
const WebSocket = createRequire(resolve(root, 'frontend/package.json'))('ws');
const phase = process.argv.includes('--before') ? 'before' : 'after';
const folder = resolve(root, '.run/concurrency-audit');
mkdirSync(folder, { recursive: true });
const report = { phase, errors: [], regressions: [], levels: [], expectedRejections: {}, maxSessions: 0, refreshCalls: 0, reconnects: 0 };
const assert = (ok, name) => { report.regressions.push({ name, pass: Boolean(ok) }); if (!ok && phase !== 'before') throw new Error(name); };
const percentile = (values, p) => +[...values].sort((a,b) => a-b)[Math.min(values.length-1, Math.ceil(values.length*p)-1)].toFixed(2);

async function holdProfile(id) {
  const child = spawn('docker', ['exec', '-i', postgres, 'psql', '-U', 'uasspain', '-d', 'test_e2e_uasspain', '-At', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', () => {});
  child.stdin.write(`BEGIN; SELECT id FROM accounts_userprofile WHERE id='${uuid(id)}' FOR UPDATE; SELECT 'LOCK_READY';\n`);
  for (let i = 0; i < 100 && !output.includes('LOCK_READY'); i++) await sleep(50);
  check(output.includes('LOCK_READY'), 'Deterministic profile lock');
  return async (mutation = '') => {
    child.stdin.end(`${mutation}; COMMIT;\n`);
    await new Promise((resolve, reject) => { child.on('exit', code => code === 0 ? resolve() : reject(new Error('Fixture lock transaction'))); });
  };
}
async function waitBlocked() {
  for (let i = 0; i < 80; i++) {
    if (sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%accounts_userprofile%')") === 't') return;
    await sleep(50);
  }
  throw new Error('Expected blocked authentication mutation');
}
async function socket(client) {
  const ws = new WebSocket(`ws://127.0.0.1:8010/ws/conexiones/?window_id=${client.windowId}`, { origin: 'http://localhost:8010', headers: { Cookie: Object.entries(client.cookies).map(([k,v]) => `${k}=${v}`).join('; ') }, handshakeTimeout: 15000 });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.on('error', () => {});
  return ws;
}
const allSockets = [];
let seed;
try {
  sql('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
  seed = await concurrentFixtures();
  const f = seed.fixtures[100], c = await loginFixture(f);
  let release = await holdProfile(f.id);
  const staleRole = c.call('/api/auth/session-role/', 'POST', { role: 'admin' });
  try { await waitBlocked(); } finally { await release(`UPDATE accounts_userprofile SET active_session_key='revoked-fixture',active_refresh_jti='',active_window_lookup='',session_role='instructor' WHERE id='${f.id}'`); }
  const staleResult = await staleRole;
  assert(staleResult.status === 401 && sql(`SELECT session_role FROM accounts_userprofile WHERE id='${f.id}'`) === 'instructor', 'stale_role_cannot_modify_replaced_session');
  report.expectedRejections.staleRole = staleResult.status;
  const roleRefreshClient = await loginFixture(f);
  release = await holdProfile(f.id);
  const roleRefresh = roleRefreshClient.call('/api/auth/refresh/', 'POST', {});
  try { await waitBlocked(); } finally { await release(`UPDATE accounts_userprofile SET session_role='admin' WHERE id='${f.id}'`); }
  assert((await roleRefresh).status === 200 && (await roleRefreshClient.call('/api/auth/me/')).body.session_role === 'admin', 'refresh_rechecks_role_after_profile_lock');
  const g = seed.fixtures[101];
  release = await holdProfile(g.id);
  const oldLogin = apiClient().call('/api/auth/login/', 'POST', { email: g.email, password: g.password });
  try { await waitBlocked(); } finally { await release(`UPDATE auth_user SET password=(SELECT u.password FROM auth_user u JOIN accounts_userprofile p ON p.user_id=u.id WHERE p.id='${f.id}')||'invalidated' WHERE id=(SELECT user_id FROM accounts_userprofile WHERE id='${g.id}')`); }
  const oldResult = await oldLogin;
  assert(oldResult.status === 401, 'password_rechecked_after_profile_lock');
  report.expectedRejections.stalePassword = oldResult.status;

  // Login bursts include a concurrent liveness probe. Its delay reveals CPU
  // password verification blocking async workers independently of DB latency.
  const clients = [];
  for (const count of [8, 10, 25, 50, 100]) {
    const started = performance.now(), loginTimes = [], healthTimes = [];
    let probing = true;
    const probe = (async () => { while (probing) { const t = performance.now(); const r = await fetch('http://127.0.0.1:8010/api/health/live/'); check(r.status === 200, 'Liveness under login load'); healthTimes.push(performance.now()-t); await sleep(20); } })();
    try {
      const created = await Promise.all(seed.fixtures.slice(clients.length, count).map(async f => { const t = performance.now(); const c = await loginFixture(f); loginTimes.push(performance.now()-t); return c; }));
      clients.push(...created);
    } finally { probing = false; await probe; }
    const sockets = await Promise.all(clients.slice(allSockets.length).map(socket)); allSockets.push(...sockets);
    const queryCount = () => Number(sql("SELECT COALESCE(sum(calls),0) FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat%'"));
    const queriesBefore = queryCount();
    const latency = [], endpoints = {}, errors = [], totalStart = performance.now();
    const statsPromise = promisify(execFile)('docker', ['stats', '--no-stream', '--format', '{{json .}}', 'uasspain-e2e-backend-e2e-1', 'uasspain-e2e-postgres-e2e-1', 'uasspain-e2e-redis-e2e-1'], { encoding:'utf8' });
    const paths = ['/api/auth/me/', '/api/profiles/', '/api/examenes/', '/api/resultados-examen/', '/api/materiales/', '/api/mensajes/', '/api/mensajes-staff/', '/api/conexiones/', '/api/registros-conexion/', '/api/system/status/'];
    const roles = seed.fixtures.slice(0,count).map(f => f.role);
    for (let cycle = 0; cycle < 3; cycle++) {
      await Promise.all(clients.map(async (c,index) => {
        const allowed = roles[index] === 'admin' ? paths.filter(p => p !== '/api/mensajes/') : roles[index] === 'instructor' ? paths.slice(0,9) : paths.slice(0,6);
        for (const path of allowed) {
          const t = performance.now(), response = await c.call(path), elapsed = performance.now()-t;
          latency.push(elapsed); (endpoints[path] ||= []).push(elapsed);
          if (response.status !== 200) errors.push({ path, status: response.status, role: roles[index] });
          if (path === '/api/auth/me/') check(response.body.profile.id === seed.fixtures[index].id, 'Independent cookie identity');
        }
      }));
      const refresh = await Promise.all(clients.map(c => c.call('/api/auth/refresh/', 'POST', {})));
      report.refreshCalls += clients.length;
      check(refresh.every(r => r.status === 200), 'Independent concurrent refresh rotation');
    }
    const dbQueries = queryCount() - queriesBefore;
    const queryTimings = JSON.parse(sql("SELECT COALESCE(jsonb_agg(jsonb_build_object('calls',calls,'meanMs',mean_exec_time,'maxMs',max_exec_time,'sharedBlocksHit',shared_blks_hit,'sharedBlocksRead',shared_blks_read) ORDER BY total_exec_time DESC),'[]') FROM (SELECT * FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat%' ORDER BY total_exec_time DESC LIMIT 10) q"));
    const stats = (await statsPromise).stdout.trim().split('\n').map(JSON.parse);
    const level = { concurrent_sessions: count, requests: latency.length, errors, p50: percentile(latency,.5), p95: percentile(latency,.95), p99: percentile(latency,.99), requestsPerSecond: +(latency.length/((performance.now()-totalStart)/1000)).toFixed(2), wsConnections: allSockets.filter(ws => ws.readyState === WebSocket.OPEN).length, wsReconnects: 0, loginP95: percentile(loginTimes,.95), livenessP95: percentile(healthTimes,.95), durationMs: +(performance.now()-started).toFixed(0), endpoints: Object.fromEntries(Object.entries(endpoints).map(([p,v]) => [p,{ requests:v.length,p50:percentile(v,.5),p95:percentile(v,.95),p99:percentile(v,.99) }])), stats };
    Object.assign(level, { dbQueries, queryTimings });
    report.levels.push(level); report.errors.push(...errors); report.maxSessions = count;
    console.log(JSON.stringify({ ...level, endpoints: undefined, stats: undefined }));
    check(errors.length === 0 && level.wsConnections === count, 'Normal load HTTP and WebSocket gates');
  }
  // Same identity, separate devices: only the newest session survives. Window
  // mismatches, stale refreshes and replay failures here are expected security tests.
  const current = clients[7], replay = apiClient(current.windowId, { ...current.cookies });
  assert((await current.call('/api/auth/session-role/', 'POST', { role:'instructor' })).status === 200, 'multirole_switch_awaited');
  assert((await current.call('/api/auth/me/')).body.session_role === 'instructor', 'multirole_me_reconciled');
  assert((await current.call('/api/auth/refresh/', 'POST', {})).status === 200, 'refresh_rotation');
  assert((await replay.call('/api/auth/refresh/', 'POST', {})).status === 401, 'refresh_replay_rejected');
  const replacement = await loginFixture(seed.fixtures[7]);
  assert((await current.call('/api/auth/me/')).status === 401, 'multidevice_replaces_old_window');
  assert((await current.call('/api/auth/logout/', 'POST', {})).status === 200 && (await replacement.call('/api/auth/me/')).status === 200, 'stale_logout_preserves_new_device');
  for (const size of [10,50,100]) {
    const responses = await Promise.all(Array.from({length:size},(_,i) => clients[3+i%4].call('/api/mensajes/', 'POST', {contenido:`concurrent-${size}-${i}`})));
    assert(responses.every(r => r.status === 201), `chat_burst_${size}_no_loss`);
    assert(new Set(responses.map(r => r.body.id)).size === size, `chat_burst_${size}_unique_ids`);
  }
  if (phase === 'after') {
    // More than either frontend list limit: totals must remain exact and scoped.
    sql(`INSERT INTO examenes_resultadoexamen(id,created_date,updated_date,examen_nombre,categoria,modalidad,respuestas,aciertos,errores,nota,porcentaje,tiempo_empleado,aprobado,fecha,alumno_id,examen_id,detalle_revision)
      SELECT gen_random_uuid(),NOW(),NOW(),'Concurrent fixture','A1/A3','teorico','{}'::jsonb,8,2,8,80,10,true,NOW(),'${seed.fixtures[3].id}'::uuid,NULL,'[]'::jsonb FROM generate_series(1,600)`);
    const studentCounts = await clients[3].call('/api/dashboard/counts/');
    const otherCounts = await clients[4].call('/api/dashboard/counts/');
    const instructorCounts = await clients[2].call('/api/dashboard/counts/');
    assert(studentCounts.status === 200 && studentCounts.body.results === 600 && studentCounts.body.passed === 600 && studentCounts.body.average_grade === 8, 'aggregate_counts_exceed_list_limits');
    assert(otherCounts.body.results === 0 && instructorCounts.body.results === 600, 'aggregate_counts_are_identity_scoped');
    const query = (await import('node:fs')).readFileSync(resolve(root,'backend-rust/src/dashboard.rs'),'utf8').split('r#"')[1].split('"#;')[0];
    const plan = sql(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.replaceAll('$1',"'instructor'").replaceAll('$2',`'${seed.fixtures[2].id}'::uuid`)}`);
    writeFileSync(resolve(folder,'dashboard-explain.json'), plan);
    sql(`DELETE FROM examenes_resultadoexamen WHERE alumno_id='${seed.fixtures[3].id}'`);
  }
  assert(report.errors.length === 0, 'normal_load_no_unexpected_http_errors');
  console.log(`CONCURRENT_SESSIONS_E2E=${report.regressions.filter(r=>r.pass).length}/${report.regressions.length}; phase=${phase}`);
} catch (error) {
  report.failure = error.message.split('\n')[0]; process.exitCode = 1; console.error(`CONCURRENT_SESSIONS_E2E=FAIL; gate=${report.failure}`);
} finally {
  for (const ws of allSockets) ws.terminate();
  if (seed) await seed.cleanup();
  writeFileSync(resolve(folder, `concurrent-${phase}.json`), JSON.stringify(report,null,2));
}
