import { createCipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { adminClient, apiClient, check, registerFixture, sql, uuid } from './auth-fixtures.mjs';

const quote = value => `'${String(value).replaceAll("'", "''")}'`;
// Only the guarded, disposable E2E database is reachable through sql(). No
// production credential, hash, session key or JWT is read or manufactured.
export async function concurrentFixtures(count = 102) {
  check(Number.isInteger(count) && count >= 8 && count <= 102, 'Fixture count');
  const admin = await adminClient();
  const source = await registerFixture('Concurrent');
  const key = Buffer.from(process.env.E2E_FIELD_ENCRYPTION_KEY, 'base64');
  const blindKey = createHash('sha256').update(key).update('|blind-index|v1').digest();
  const encrypt = value => {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
    return 'v1:' + Buffer.concat([nonce, cipher.update(value), cipher.final(), cipher.getAuthTag()]).toString('base64').replaceAll('+', '-').replaceAll('/', '_');
  };
  const blind = value => createHmac('sha256', blindKey).update(value).digest('hex');
  const fixtures = Array.from({ length: count }, (_, index) => {
    const id = randomUUID(), email = `concurrent-${id}@test.local`;
    const role = index === 0 ? 'admin' : index === 1 || index === 2 || index >= 100 ? 'instructor' : 'alumno';
    return { id, email, password: source.password, role, roles: index === 7 || index >= 100 ? ['instructor', 'admin', 'alumno'] : [role] };
  });
  // A single API-generated synthetic password hash is copied inside PostgreSQL
  // to make large fixtures affordable. Authentication still uses real login,
  // real cookies, window binding, token rotation and the unchanged rate limit.
  for (const [index, f] of fixtures.entries()) {
    const assigned = f.role === 'alumno' ? quote(fixtures[1 + index % 2].id) + '::uuid' : 'NULL';
    sql(`WITH u AS (INSERT INTO auth_user(password,last_login,is_superuser,username,first_name,last_name,email,is_staff,is_active,date_joined)
      SELECT password,NULL,false,${quote('concurrent-' + f.id)},'','',${quote(f.email)},false,true,NOW() FROM auth_user WHERE id=${Number(source.userId)} RETURNING id)
      INSERT INTO accounts_userprofile(id,created_date,updated_date,nombre,apellidos,email,username,dni_nie,foto_perfil,status,role,otp_hash,otp_verified,user_id,roles,username_lookup,email_lookup,dni_lookup,fecha_nacimiento,active_session_key,login_otp_hash,session_role,assigned_instructor_id)
      SELECT '${uuid(f.id)}',NOW(),NOW(),${quote(encrypt('Concurrent'))},${quote(encrypt(String(index)))},${quote(encrypt(f.email))},${quote(encrypt(f.email))},${quote(encrypt(f.id))},'','activo',${quote(f.role)},'',true,u.id,${quote(JSON.stringify(f.roles))}::jsonb,${quote(blind(f.email))},${quote(blind(f.email))},${quote(blind(f.id.toUpperCase()))},${quote(encrypt('2000-01-01'))},'','','',${assigned} FROM u;`);
  }
  key.fill(0); blindKey.fill(0);
  return { fixtures, admin, async cleanup() {
    for (const f of [...fixtures, source]) {
      check((await admin.call(`/api/profiles/${uuid(f.id)}/`, 'DELETE')).status === 204, 'Concurrent fixture cleanup');
      f.password = '';
    }
  } };
}

export async function loginFixture(f, client = apiClient()) {
  const response = await client.call('/api/auth/login/', 'POST', { email: f.email, password: f.password });
  check(response.status === 200, `Concurrent fixture login status=${response.status}`);
  return client;
}
