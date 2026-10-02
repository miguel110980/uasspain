import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
const project = process.argv[3] || 'uasspain-rebuild-20261003';
if (!['backup', 'restore-admin', 'verify'].includes(mode)) throw new Error('Usage: node tools/postgres-rebuild.mjs backup|restore-admin|verify [uasspain-rebuild-NAME]');
if (!/^uasspain-rebuild-[a-z0-9_-]+$/.test(project)) throw new Error('Target must be a separate uasspain-rebuild-* project');
const artifactRoot = resolve(root, '.run', project);
mkdirSync(artifactRoot, { recursive: true });
const encryptedPath = resolve(artifactRoot, 'original-database.pgcustom.enc');
const manifestPath = resolve(artifactRoot, 'backup-manifest.json');
const master = Buffer.from(readFileSync(resolve(root, '.secrets/field_encryption_key'), 'utf8').trim(), 'base64url');
assert.equal(master.length, 32, 'Expected current field encryption key');
const key = createHash('sha256').update(master).update('|uasspain|backup-encryption|v2').digest();
const compose = target => target === 'uasspain' ? ['compose', '-p', 'uasspain', '-f', 'docker-compose.yml']
  : ['compose', '-p', target, '-f', 'docker-compose.yml', '-f', 'docker-compose.encrypted.yml', '-f', 'docker-compose.rebuild.yml'];
function docker(args, input) {
  const result = spawnSync('docker', args, { cwd: root, input, maxBuffer: 256 * 1024 * 1024 });
  // Never print pg_dump/COPY output, authentication material or failed SQL payloads.
  if (result.error || result.status !== 0) throw new Error(`Docker operation failed (${args[0]}, exit ${result.status}); sensitive output withheld`);
  return result.stdout;
}
const sql = (target, query) => docker([...compose(target), 'exec', '-T', 'postgres', 'psql', '-X', '-U', 'uasspain', '-d', 'uasspain', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query]).toString('utf8').trim();
const sha = buffer => createHash('sha256').update(buffer).digest('hex');
function decrypt(buffer) {
  const decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12));
  decipher.setAuthTag(buffer.subarray(-16));
  return Buffer.concat([decipher.update(buffer.subarray(12, -16)), decipher.final()]);
}
try {
  if (mode === 'backup') {
    if (existsSync(encryptedPath) || existsSync(manifestPath)) throw new Error('Existing backup will not be overwritten; use another project name');
    const accountState = sql('uasspain', "SELECT json_build_object('users',(SELECT count(*) FROM auth_user),'profiles',(SELECT count(*) FROM accounts_userprofile),'admins',(SELECT count(*) FROM accounts_userprofile WHERE role='admin' AND roles ? 'admin'),'migrations',(SELECT count(*) FROM _sqlx_migrations WHERE success))");
    const state = JSON.parse(accountState);
    assert.equal(state.users, 1, 'Administrator-only rebuild requires exactly one existing account');
    assert.equal(state.profiles, 1);
    assert.equal(state.admins, 1);
    assert.equal(state.migrations, 7);
    const dump = docker([...compose('uasspain'), 'exec', '-T', 'postgres', 'pg_dump', '-U', 'uasspain', '-d', 'uasspain', '--format=custom']);
    assert.equal(dump.subarray(0, 5).toString(), 'PGDMP');
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const encrypted = Buffer.concat([nonce, cipher.update(dump), cipher.final(), cipher.getAuthTag()]);
    assert.equal(sha(decrypt(encrypted)), sha(dump));
    writeFileSync(encryptedPath, encrypted, { mode: 0o600 });
    const manifest = { created_utc: new Date().toISOString(), format: 'pg_dump-custom+AES-256-GCM-v2', source_project: 'uasspain', target_project: project, state, plaintext_sha256: sha(dump), encrypted_sha256: sha(encrypted), bytes: encrypted.length };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify({ backup: encryptedPath, encrypted: true, authenticated_roundtrip: true, state }));
  } else if (mode === 'restore-admin') {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.target_project, project);
    const model = JSON.parse(docker([...compose(project), 'config', '--format', 'json']).toString());
    const sourceMounts = JSON.parse(docker(['inspect','uasspain-postgres','--format','{{json .Mounts}}']).toString());
    assert.ok(model.volumes.postgres_ciphertext, 'Target must use encrypted storage');
    assert.ok(!sourceMounts.some(mount=>mount.Name===model.volumes.postgres_ciphertext.name), 'Target would overwrite active data');
    assert.equal(sql(project, 'SELECT count(*) FROM auth_user'), '0', 'Target must be empty');
    assert.equal(sql(project, 'SELECT count(*) FROM accounts_userprofile'), '0');
    const encrypted = readFileSync(encryptedPath);
    assert.equal(sha(encrypted), manifest.encrypted_sha256);
    const dump = decrypt(encrypted);
    assert.equal(sha(dump), manifest.plaintext_sha256);
    docker([...compose(project), 'exec', '-T', 'postgres', 'pg_restore', '-U', 'uasspain', '-d', 'uasspain', '--data-only', '--single-transaction', '--table=auth_user', '--table=accounts_userprofile'], dump);
    sql(project, "SELECT setval('auth_user_id_seq', (SELECT max(id) FROM auth_user), true); UPDATE accounts_userprofile SET active_session_key='',session_role='',login_otp_hash='',login_otp_created_at=NULL;");
    assert.equal(sql(project, 'SELECT count(*) FROM auth_user'), '1');
    assert.equal(sql(project, 'SELECT count(*) FROM accounts_userprofile'), '1');
    console.log(JSON.stringify({ target_project: project, restored_administrators: 1, schema_from_migrations: true, password_and_encrypted_profile_preserved: true }));
  } else {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.target_project, project);
    const encrypted = readFileSync(encryptedPath);
    assert.equal(sha(encrypted), manifest.encrypted_sha256);
    const dump = decrypt(encrypted);
    assert.equal(sha(dump), manifest.plaintext_sha256);
    const catalog = `SELECT json_build_object(
      'columns',(SELECT json_agg(row_to_json(x) ORDER BY table_name,ordinal_position) FROM (SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public') x),
      'constraints',(SELECT json_agg(row_to_json(x) ORDER BY relation,name) FROM (SELECT c.conrelid::regclass::text AS relation,c.conname AS name,c.contype AS type,pg_get_constraintdef(c.oid) AS definition,c.convalidated AS validated FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public') x),
      'indexes',(SELECT json_agg(row_to_json(x) ORDER BY tablename,indexname) FROM (SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public') x),
      'migrations',(SELECT json_agg(row_to_json(x) ORDER BY version) FROM (SELECT version,description,success,encode(checksum,'hex') AS checksum FROM _sqlx_migrations) x))`;
    const original = JSON.parse(sql('uasspain', catalog));
    assert.deepEqual(JSON.parse(sql(project, catalog)), original, 'Migration schema differs from source');
    const state = JSON.parse(sql(project, `SELECT json_build_object(
      'users',(SELECT count(*) FROM auth_user),'profiles',(SELECT count(*) FROM accounts_userprofile),
      'pii_encrypted',(SELECT bool_and(nombre LIKE 'v1:%' AND apellidos LIKE 'v1:%' AND email LIKE 'v1:%' AND username LIKE 'v1:%' AND dni_nie LIKE 'v1:%' AND fecha_nacimiento LIKE 'v1:%') FROM accounts_userprofile),
      'argon2id',(SELECT bool_and(password LIKE 'argon2$argon2id$%') FROM auth_user),
      'admin_only',(SELECT bool_and(role='admin' AND roles='["admin"]'::jsonb AND status='activo' AND otp_verified) FROM accounts_userprofile),
      'app_no_ddl',NOT has_schema_privilege('uasspain_app','public','CREATE'),
      'app_migrations_readonly',has_table_privilege('uasspain_app','_sqlx_migrations','SELECT') AND NOT has_table_privilege('uasspain_app','_sqlx_migrations','INSERT,UPDATE,DELETE'),
      'backup_readonly',has_table_privilege('uasspain_backup','auth_user','SELECT') AND NOT has_table_privilege('uasspain_backup','auth_user','INSERT,UPDATE,DELETE'),
      'runtime_unprivileged',(SELECT bool_and(NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) FROM pg_roles WHERE rolname IN ('uasspain_app','uasspain_backup','uasspain_monitor')),
      'scram_credentials',(SELECT bool_and(rolpassword LIKE 'SCRAM-SHA-256$%') FROM pg_authid WHERE rolname LIKE 'uasspain_%'),
      'backend_tls',(SELECT bool_and(s.ssl AND s.version IN ('TLSv1.2','TLSv1.3')) FROM pg_stat_activity a JOIN pg_stat_ssl s USING(pid) WHERE a.usename='uasspain_app'))`));
    assert.equal(state.users, 1); assert.equal(state.profiles, 1);
    for (const [name, value] of Object.entries(state)) if (!['users','profiles'].includes(name)) assert.equal(value, true, name);
    const identity = "SELECT json_agg(json_build_array(p.id,p.user_id,u.password,p.nombre,p.apellidos,p.email,p.username,p.dni_nie,p.fecha_nacimiento,p.email_lookup,p.username_lookup,p.dni_lookup) ORDER BY p.id) FROM accounts_userprofile p JOIN auth_user u ON u.id=p.user_id";
    assert.equal(sha(Buffer.from(sql(project,identity))),sha(Buffer.from(sql('uasspain',identity))), 'Existing administrator changed');
    const candidate = `${project}-postgres`;
    const connectionScript = 'export PGPASSWORD="$(cat /run/secrets/db_app_password)" PGSSLROOTCERT=/run/secrets/pg_tls_ca; exec psql -X -h postgres -U uasspain_app -d uasspain -At -c "SELECT current_user,ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()"';
    const tls = docker([...compose(project),'exec','-T','-e','PGSSLMODE=verify-full','backend','sh','-c',connectionScript]).toString().trim();
    assert.equal(tls,'uasspain_app|t', 'Verified TLS connection failed');
    const plain = spawnSync('docker',[...compose(project),'exec','-T','-e','PGSSLMODE=disable','backend','sh','-c',connectionScript],{cwd:root});
    assert.notEqual(plain.status,0,'Unencrypted connection unexpectedly permitted');
    assert.match(plain.stderr.toString(),/no encryption/);
    for (const statement of ["SET ROLE uasspain_app; DELETE FROM _sqlx_migrations WHERE false", "SET ROLE uasspain_backup; DELETE FROM auth_user WHERE false", "SET ROLE uasspain_app; BEGIN; CREATE TABLE public.rebuild_permission_probe(id int); ROLLBACK;"]) {
      const result = spawnSync('docker', ['exec', '-i', candidate, 'psql','-X','-U','uasspain','-d','uasspain','-v','ON_ERROR_STOP=1','-c',statement], {cwd:root});
      assert.notEqual(result.status, 0, 'Forbidden SQL unexpectedly permitted');
      assert.match(result.stderr.toString(), /permission denied/);
    }
    const recoveryDatabase = 'uasspain_rebuild_recovery_check';
    assert.equal(sql(project, `SELECT count(*) FROM pg_database WHERE datname='${recoveryDatabase}'`), '0', 'Recovery destination already exists');
    docker(['exec', candidate, 'createdb','-U','uasspain', recoveryDatabase]);
    try {
      docker(['exec','-i',candidate,'pg_restore','-U','uasspain','-d',recoveryDatabase,'--single-transaction'],dump);
      const recoveredCatalog = JSON.parse(docker(['exec',candidate,'psql','-X','-U','uasspain','-d',recoveryDatabase,'-At','-c',catalog]).toString());
      // pg_dump/pg_restore reanaliza CHECK con ANY: PostgreSQL distribuye el
      // cast text[] sobre los elementos varchar. Normalizamos solo esa forma
      // equivalente; la base reconstruida se comparó literalmente arriba.
      const normalizeRestored = value => JSON.stringify(value).replace(/\(\(ARRAY\['draft'::character varying, 'published'::character varying\]\)::text\[\]\)/g, "(ARRAY[('draft'::character varying)::text, ('published'::character varying)::text])").replace(/\(\(ARRAY\['upcoming'::character varying, 'published'::character varying\]\)::text\[\]\)/g, "(ARRAY[('upcoming'::character varying)::text, ('published'::character varying)::text])");
      assert.equal(sha(Buffer.from(normalizeRestored(recoveredCatalog))), sha(Buffer.from(normalizeRestored(original))), 'Full encrypted backup restore differs');
      assert.equal(docker(['exec',candidate,'psql','-X','-U','uasspain','-d',recoveryDatabase,'-At','-c','SELECT count(*) FROM accounts_userprofile']).toString().trim(), '1');
    } finally {
      docker(['exec',candidate,'dropdb','-U','uasspain',recoveryDatabase]);
    }
    const storagePath = resolve(artifactRoot,'storage-verification.json');
    const storage = existsSync(storagePath) ? JSON.parse(readFileSync(storagePath,'utf8')) : null;
    const report = {verified_utc:new Date().toISOString(),state,tables:new Set(original.columns.map(c=>c.table_name)).size,columns:original.columns.length,constraints:original.constraints.length,indexes:original.indexes.length,migrations:original.migrations.length,schema_equal:true,administrator_preserved:true,tls_verify_full:true,unencrypted_connection_denied:true,forbidden_sql_denied:true,full_encrypted_backup_restore:true,storage_encryption:storage?.storage_encryption || 'UNVERIFIED',storage_activation_allowed:storage?.activation_allowed || false};
    writeFileSync(resolve(artifactRoot,'database-verification.json'), `${JSON.stringify(report,null,2)}\n`);
    console.log(JSON.stringify(report));
  }
} catch (error) {
  console.error(`Rebuild failed: ${error.message.split('\n')[0]}`);
  process.exitCode = 1;
} finally {
  master.fill(0);
  key.fill(0);
}
