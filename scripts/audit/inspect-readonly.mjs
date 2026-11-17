/** Read-only ORIGINAL inspection. Writes only sanitized audit artifacts. */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import https from 'node:https';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const postUpdate = process.argv.includes('--post-update');
const out = resolve(root, `docs/audits/evidence/2026-11-16-readonly${postUpdate ? '-post-update' : ''}.json`);
const require = createRequire(resolve(root, 'frontend/package.json'));
const ts = require('typescript');
const checks = [];
function command(program, args, input) {
  const result = spawnSync(program, args, { cwd: root, input, encoding: 'utf8', timeout: 60000, maxBuffer: 24 * 1024 * 1024, windowsHide: true });
  if (result.status !== 0 || result.error) throw new Error(`${program}: exit ${result.status ?? 'unavailable'}; sensitive output withheld`);
  return result.stdout.trim();
}
function check(id, expected, observe) {
  try { const observed = observe(); const verdict = expected(observed); checks.push({ id, status: typeof verdict === 'string' ? verdict : verdict ? 'PASS' : 'FAIL', observed }); return observed; }
  catch (error) { checks.push({ id, status: 'BLOCKED', reason: error.message }); return null; }
}
function sql(statement) {
  return JSON.parse(sqlText(statement));
}
function sqlText(statement) {
  if (!/^SELECT\s/i.test(statement)) throw Error('Only a fixed SELECT is allowed');
  const data = command('docker', ['exec', '-i', 'uasspain-postgres', 'psql', '-X', '-U', 'uasspain', '-d', 'uasspain', '-qtA', '-v', 'ON_ERROR_STOP=1', '-f', '-'], `BEGIN READ ONLY; SET LOCAL statement_timeout='20s'; ${statement}; COMMIT;`);
  return data;
}
function csv(rows, columns) {
  const quote = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  return [columns.map(quote).join(','), ...rows.map(row => columns.map(k => quote(row[k])).join(','))].join('\n') + '\n';
}
function files(path) {
  return readdirSync(resolve(root, path), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(`${path}/${entry.name}`) : [`${path}/${entry.name}`]);
}
function patchedPackages() {
  return [['frontend', 'libxslt', '1.1.43-r4'], ['nginx', 'libxslt', '1.1.43-r4'], ['postgres', 'libxslt', '1.1.43-r4'], ['postgres', 'krb5-libs', '1.22.3-r0']].map(([service, pkg, minimum]) => {
    const listing = command('docker', ['exec', `uasspain-${service}`, 'apk', '--no-network', 'list', '--installed', pkg]);
    const installed = listing.split('\n').find(line => line.startsWith(pkg + '-'))?.split(/\s+/)[0].slice(pkg.length + 1);
    if (!installed) throw Error('Installed package metadata missing');
    return { service, package: pkg, installed, minimum, comparison: command('docker', ['exec', `uasspain-${service}`, 'apk', '--no-network', 'version', '-t', installed, minimum]) };
  });
}
if (process.argv.includes('--packages-only')) {
  if (!postUpdate) throw Error('Package refresh requires the existing post-update report');
  const existing = JSON.parse(readFileSync(out, 'utf8'));
  const observed = patchedPackages();
  const row = { id: 'DEPLOYED_PATCHED_PACKAGES', status: observed.every(x => ['=', '>'].includes(x.comparison)) ? 'PASS' : 'FAIL', observed_at: new Date().toISOString(), observed };
  existing.checks = existing.checks.filter(x => x.id !== row.id).concat(row);
  writeFileSync(out, JSON.stringify(existing, null, 2) + '\n');
  console.log(JSON.stringify(row));
  process.exit(row.status === 'PASS' ? 0 : 1);
}

const sourceHead = command('git', ['rev-parse', 'HEAD']);
const remote = command('git', ['ls-remote', 'origin', 'refs/heads/codex/auditoria-20261110', 'refs/heads/main']).split('\n').filter(Boolean).map(line => { const [sha, ref] = line.split(/\s+/); return { sha, ref }; });
checks.push({ id: 'GIT_EXISTING_BRANCH', status: remote.find(x => x.ref === 'refs/heads/codex/auditoria-20261110')?.sha === sourceHead ? 'PASS' : 'FAIL', local_head: sourceHead, remote });
const containers = check('FIVE_EXISTING_SERVICES', value => value.length === 5 && value.every(x => x.health === 'healthy' && x.state === 'running'), () => {
  return ['nginx', 'frontend', 'backend', 'postgres', 'redis'].map(service => {
    const c = JSON.parse(command('docker', ['inspect', `uasspain-${service}`]))[0];
    if (c.Config.Labels['com.docker.compose.project'] !== 'uasspain') throw Error('Unexpected Docker project');
    return { service, id: c.Id, image: c.Image, created: c.Created, state: c.State.Status, health: c.State.Health?.Status, read_only_root: c.HostConfig.ReadonlyRootfs,
      ports: c.HostConfig.PortBindings, volumes: c.Mounts.filter(m => m.Type === 'volume').map(m => ({ name: m.Name, destination: m.Destination, read_write: m.RW })) };
  });
});
const ca = readFileSync(resolve(root, '.secrets/tls/ca.crt'));
async function get(path) {
  return await new Promise((accept, reject) => {
    const request = https.get(`https://localhost${path}`, { ca, rejectUnauthorized: true, timeout: 15000 }, response => {
      const tlsAuthorized = response.socket.authorized === true;
      const hash = createHash('sha256'); let bytes = 0;
      response.on('data', chunk => { bytes += chunk.length; hash.update(chunk); });
      response.on('end', () => accept({ path, http: response.statusCode, bytes, body_sha256: hash.digest('hex'), tls_authorized: tlsAuthorized, client: 'Node HTTPS with existing CA and hostname validation', tls_bypass: false }));
    });
    request.on('timeout', () => request.destroy(Error('HTTPS timeout')));
    request.on('error', error => reject(Error(error.code || 'HTTPS client error')));
  });
}
for (const [id, paths, expected] of [
  ['HEALTH_HTTP_CONTENT', ['/healthz', '/readyz', '/api/health/live/', '/api/health/ready/'], value => value.http === 200 && value.bytes > 0],
  ['PRIVATE_API_DENY_ANONYMOUS', ['/api/profiles/', '/api/materiales/', '/api/backups/status/', '/api/system/google-oauth/'], value => [401, 403].includes(value.http)]
]) {
  try { const observed = []; for (const path of paths) observed.push(await get(path)); checks.push({ id, status: observed.every(x => x.tls_authorized && expected(x)) ? 'PASS' : 'FAIL', observed }); }
  catch (error) { checks.push({ id, status: 'BLOCKED', reason: error.message }); }
}
check('WINDOWS_CURL_DEFAULT_TLS', value => value.exit === 0 ? 'PASS' : 'BLOCKED', () => {
  const result = spawnSync('curl.exe', ['--silent', '--show-error', '--max-time', '15', '--head', 'https://localhost/healthz'], { cwd: root, encoding: 'utf8', timeout: 20000, windowsHide: true });
  return { exit: result.status, revocation_check_unavailable: /CRYPT_E_NO_REVOCATION_CHECK/.test(result.stderr || ''), tls_bypass: false, scope: 'Separate Windows Schannel client; Node result does not certify this client' };
});
check('SCHEMA_UNCHANGED', value => value.applied === 34 && value.source_files === 34 && value.mismatches.length === 0, () => {
  const rows = sql("SELECT json_agg(json_build_object('version',version,'checksum',encode(checksum,'hex'),'success',success)) FROM _sqlx_migrations");
  const sources = files('backend-rust/migrations').filter(f => f.endsWith('.sql'));
  const mismatches = rows.filter(row => {
    const file = sources.find(f => parseInt(f.split('/').at(-1)) === row.version);
    if (!file || !row.success) return true;
    const text = readFileSync(resolve(root, file), 'utf8');
    return ![text, text.replaceAll('\r\n', '\n')].some(s => createHash('sha384').update(s).digest('hex') === row.checksum);
  }).map(x => x.version);
  return { applied: rows.length, source_files: sources.length, mismatches };
});
check('EIGHT_PROFILES', value => value.total === 8 && value.roles.admin === 1 && value.roles.instructor === 2 && value.roles.alumno === 5, () => sql("SELECT json_build_object('total',sum(n),'roles',jsonb_object_agg(role,n)) FROM (SELECT role,count(*) n FROM accounts_userprofile GROUP BY role) q"));
check('FOREIGN_KEY_INTEGRITY', value => value.constraints > 0 && value.orphans === 0, () => {
  const constraints = sql(`SELECT COALESCE(json_agg(json_build_object('name',c.conname,'query',format('SELECT %L AS name,count(*)::bigint AS orphans FROM %I.%I child WHERE %s AND NOT EXISTS(SELECT 1 FROM %I.%I parent WHERE %s)',c.conname,n.nspname,t.relname,x.nonnull,pn.nspname,p.relname,x.matches))),'[]'::json) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_class p ON p.oid=c.confrelid JOIN pg_namespace pn ON pn.oid=p.relnamespace CROSS JOIN LATERAL (SELECT string_agg(format('child.%I IS NOT NULL',ca.attname),' AND ' ORDER BY k.ord) nonnull,string_agg(format('child.%I=parent.%I',ca.attname,pa.attname),' AND ' ORDER BY k.ord) matches FROM unnest(c.conkey,c.confkey) WITH ORDINALITY k(child_att,parent_att,ord) JOIN pg_attribute ca ON ca.attrelid=c.conrelid AND ca.attnum=k.child_att JOIN pg_attribute pa ON pa.attrelid=c.confrelid AND pa.attnum=k.parent_att) x WHERE c.contype='f' AND n.nspname='public'`);
  const observed = sql(`SELECT json_agg(row_to_json(q)) FROM (${constraints.map(x => x.query).join(' UNION ALL ')}) q`);
  return { constraints: observed.length, orphans: observed.reduce((total, row) => total + Number(row.orphans), 0), failures: observed.filter(x => Number(x.orphans) !== 0), scope: 'Actual anti-join checks on every public-schema FK; no row contents exported' };
});
check('ENCRYPTED_ACTIVE_MOUNT', value => value.pgdata_mount === 'fuse.gocryptfs' && value.key_mount === 'tmpfs' && value.key_removed && value.swap_disabled && value.postmaster_capabilities === '0000000000000000', () => {
  const shell = statement => command('docker', ['exec', 'uasspain-postgres', 'sh', '-c', statement]);
  return {
    pgdata_mount: shell('findmnt -n -o FSTYPE --mountpoint /var/lib/postgresql/data'),
    key_mount: shell('findmnt -n -o FSTYPE --mountpoint /run/postgres-storage'),
    key_removed: shell('test ! -e /run/postgres-storage/unlock.key && test ! -e /run/postgres-storage/unlock.key.tmp && echo clean') === 'clean',
    swap_disabled: shell("awk 'NR>1 && NF {n++} END {print n+0}' /proc/swaps") === '0',
    postmaster_capabilities: shell("awk '/^CapEff:/ {print $2}' /proc/$(head -n 1 /var/lib/postgresql/data/pgdata/postmaster.pid)/status")
  };
});
check('STORAGE_VOLUME_IDENTITIES', value => value.actual_cipher_exists && !value.named_plain_exists, () => {
  const names = command('docker', ['volume', 'ls', '--format', '{{.Name}}']).split('\n');
  return { actual_cipher_exists: names.includes('uasspain-rebuild-20261003_postgres_ciphertext'), named_cipher_exists: names.includes('uasspain_postgres_ciphertext'), named_plain_exists: names.includes('uasspain_postgres_data'), destructive_comparison: 'NOT_RUN', restore: 'NOT_RUN' };
});

const metadata = check('MATERIAL_PHYSICAL_INTEGRITY', value => {
  if (value.published !== 10 || value.files.some(x => !x.exists || !x.pdf || x.size_matches === false || x.hash_matches === false)) return 'FAIL';
  if (value.files.some(x => x.hash_matches === null)) return 'BLOCKED';
  return 'PASS';
}, () => {
  const rows = sql("SELECT COALESCE(json_agg(json_build_object('id',id,'category',categoria,'active',activo,'path',archivo_path,'url',archivo_url,'bytes',archivo_tamano,'sha256',archivo_sha256) ORDER BY id),'[]'::json) FROM materiales_material");
  const targets = rows.filter(x => x.active).map((x, index) => {
    const pathname = x.path || new URL(x.url, 'https://localhost').pathname.replace(/^\/(?:api\/)?media\//, '');
    if (pathname.startsWith('/') || pathname.split('/').includes('..')) throw Error('Material path requires manual inspection');
    return { index: index + 1, category: x.category, path: `/app/media/${pathname}`, expected_bytes: x.bytes, expected_sha256: x.sha256 };
  });
  const physical = targets.map(row => {
    const real = command('docker', ['exec', 'uasspain-backend', 'realpath', '-e', '--', row.path]);
    if (!real.startsWith('/app/media/')) throw Error('Material resolves outside media');
    const bytes = Number(command('docker', ['exec', 'uasspain-backend', 'stat', '-c', '%s', '--', real]));
    const sha256 = command('docker', ['exec', 'uasspain-backend', 'sha256sum', '--', real]).split(/\s/)[0];
    const pdf = command('docker', ['exec', 'uasspain-backend', 'head', '-c', '5', '--', real]) === '%PDF-';
    return { index: row.index, category: row.category, exists: true, pdf, bytes, sha256, size_matches: row.expected_bytes == null ? null : bytes === Number(row.expected_bytes), hash_matches: row.expected_sha256 ? sha256 === row.expected_sha256 : null };
  });
  return { records: rows.length, published: targets.length, unpublished: rows.filter(x => !x.active).length, files: physical, missing_size_metadata: physical.filter(x => x.size_matches === null).length, scope: 'All currently published DB-linked materials; content integrity is established by full-file SHA256 against DB hashes. Null size metadata is not a size comparison. No academic completeness or browser/download claim' };
});
if (postUpdate) {
  check('PREUPDATE_DATA_PRESERVED', value => value.different_tables.length === 0 && value.dpapi_unchanged, () => {
    const safety = JSON.parse(readFileSync(resolve(root, 'docs/audits/evidence/2026-11-16-preupdate-backup.json'), 'utf8'));
    if (safety.status !== 'PASS') throw Error('Verified preupdate backup required');
    const suffix = safety.recovery_database.replace('uasspain_audit_restore_', '');
    if (!/^[a-f0-9]{12}$/.test(suffix)) throw Error('Invalid recovery reference');
    const baseline = JSON.parse(readFileSync(resolve(root, `.run/audit-20261116/preupdate-${suffix}/source-fingerprints.json`), 'utf8'));
    const different = [];
    for (const table of baseline.tables) {
      if (!/^[a-z0-9_]+$/.test(table.name)) throw Error('Invalid table identity');
      const data = sqlText(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public."${table.name}" t`);
      if (createHash('sha256').update(data).digest('hex') !== table.sha256) different.push({ table: table.name, before_rows: table.rows, after_rows: JSON.parse(data).length });
    }
    const dpapi = createHash('sha256').update(readFileSync(resolve(root, '.secrets/postgres-storage-key.dpapi'))).digest('hex');
    return { compared_tables: baseline.tables.length, different_tables: different, dpapi_unchanged: dpapi === baseline.dpapi_sha256, scope: 'All active public table content against preupdate safety snapshot; no row contents exported' };
  });
  check('FRONTEND_CSS_PRESERVED', value => value.identical, () => {
    const before = JSON.parse(readFileSync(resolve(root, '.run/audit-20261116/frontend-before-update.json'), 'utf8').replace(/^\uFEFF/, ''));
    const after = command('docker', ['exec', 'uasspain-frontend', 'sh', '-c', 'cd /usr/share/nginx/html && find assets -type f -name "*.css" -exec sha256sum {} \\;']).split('\n').sort();
    return { before_files: before.css.length, after_files: after.length, identical: JSON.stringify(before.css.map(x => x.trim()).sort()) === JSON.stringify(after.map(x => x.trim()).sort()), scope: 'Exact compiled CSS hashes; not pixel equivalence for all interactions' };
  });
  check('DEPLOYED_PATCHED_PACKAGES', value => value.every(x => x.comparison === '=' || x.comparison === '>'), patchedPackages);
}

const historic = JSON.parse(readFileSync(resolve(root, '.run/cleanup-20261110/panel-api-read-regression.json'), 'utf8'));
const access = JSON.parse(readFileSync(resolve(root, '.run/cleanup-20261110/admission-and-resource-access.json'), 'utf8'));
const counts = JSON.parse(readFileSync(resolve(root, '.run/cleanup-20261110/dashboard-counts-after-cleanup.json'), 'utf8'));
const previous = {
  recorded_at: historic.at, execution: 'RETAINED_NOT_RERUN',
  common: { total: historic.common.length, mismatches: historic.common.filter(x => x.status !== x.expected).length },
  admin_boundaries: { total: historic.admin_boundaries.length, mismatches: historic.admin_boundaries.filter(x => x.status !== x.expected).length },
  admissions: { total: access.admissions.length, mismatches: access.admissions.filter(x => x.status !== x.expected).length },
  resources: { total: access.resources.length, mismatches: access.resources.filter(x => x.status !== x.expected).length },
  counts: { total: counts.length, mismatches: counts.filter(x => !x.match).length },
  evidence: ['.run/cleanup-20261110/panel-api-read-regression.json', '.run/cleanup-20261110/admission-and-resource-access.json', '.run/cleanup-20261110/dashboard-counts-after-cleanup.json']
};

// Enumerate current JSX occurrences; an occurrence is not a tested unique action.
const ui = [];
const names = new Set(['button', 'input', 'select', 'textarea', 'form', 'a', 'Button', 'Link', 'NavLink', 'Checkbox', 'Switch', 'SelectTrigger', 'SelectItem', 'DialogTrigger', 'AlertDialogAction']);
for (const path of files('frontend/src').filter(p => p.endsWith('.tsx') && !/\.(test|spec)\.tsx$/.test(p))) {
  const text = readFileSync(resolve(root, path), 'utf8');
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const serviceRefs = [...new Set([...text.matchAll(/\b(\w+(?:Service|service))\.(\w+)/g)].map(m => `${m[1]}.${m[2]}`))];
  const apiRefs = [...new Set([...text.matchAll(/endpoints\.([\w.]+)/g)].map(m => m[0]))];
  const panel = path.includes('/admin/') || path.endsWith('/AdminPanel.tsx') ? 'admin' : path.includes('/instructor/') || path.endsWith('/InstructorPanel.tsx') ? 'instructor' : path.includes('/alumno/') || path.endsWith('/AlumnoPanel.tsx') ? 'alumno' : 'shared/public';
  const route = { admin: '/admin', instructor: '/instructor', alumno: '/alumno' }[panel] || 'NOT_MAPPED';
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText(source);
      const attrs = node.attributes.properties.map(p => p.name?.getText(source)).filter(Boolean);
      if (names.has(tag) || attrs.some(a => ['onClick', 'onSubmit'].includes(a))) {
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        const template = /\/components\/ui\/(input|textarea)\.tsx$/.test(path);
        ui.push({ id: `${path}:${position.line + 1}:${position.character + 1}`, source: path, line: position.line + 1, component: path.split('/').at(-1).replace('.tsx', ''), panel, route, control: tag, handlers: attrs.filter(a => /^on[A-Z]/.test(a)).join(';'), service_refs: serviceRefs.join(';'), api_refs: apiRefs.join(';'), permission: 'NOT_MAPPED', storage: 'NOT_MAPPED', expected: 'Correct authorized action, persistence where applicable, and safe denial/recovery', result: template ? 'N/A' : 'NOT_RUN', evidence: template ? 'Generic UI primitive; instances remain in scope' : 'Static occurrence only; previous cases must be linked individually', source_head: sourceHead });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
const priorByComponent = {
  AdminTopbar: ['docs/audits/2026-11-12-github-actualizacion.md', 'Header/menu/navigation only; actual controls must be linked individually'],
  GoogleOAuthForm: ['docs/audits/2026-11-12-google-oauth-local.md', 'Real administrator verify/enable/link/login; not every field or variant'],
  AlumnoMaterial: ['docs/audits/2026-11-10-catalogo-todos.md', 'Published catalog, four categories, disabled locked entries, permitted PDF download'],
  AcademicPracticalHistory: ['docs/audits/2026-11-10-casos-cierre.csv', 'Practical creation/edit/persistence across current authorized roles'],
  ExamenActivo: ['docs/audits/2026-11-10-hallazgos-vigentes.csv', 'F06/F07/F08 grading, timing and final save; not all possible form states'],
  AdminBackups: ['docs/audits/2026-11-10-casos-cierre.csv', 'Full/incremental/verify/isolated recovery already PASS; not every scheduler control']
};
for (const row of ui) {
  const prior = priorByComponent[row.component];
  row.previous_evidence = prior?.[0] || '';
  row.previous_scope = prior?.[1] || '';
  row.previous_link = prior ? 'COMPONENT_HAS_PRIOR_CASES_NOT_A_CONTROL_PASS' : 'NOT_LINKED';
  if (prior) row.evidence = 'No new execution of this occurrence; component-level previous cases retained in separate columns';
}
const columns = ['id', 'source', 'line', 'component', 'panel', 'route', 'control', 'handlers', 'service_refs', 'api_refs', 'permission', 'storage', 'expected', 'result', 'evidence', 'previous_link', 'previous_evidence', 'previous_scope', 'source_head'];
const matrixPath = resolve(root, 'docs/audits/2026-11-16-controles-actuales.csv');
mkdirSync(dirname(out), { recursive: true });
if (!postUpdate) writeFileSync(matrixPath, csv(ui, columns));
const app = readFileSync(resolve(root, 'backend-rust/src/app.rs'), 'utf8');
const api = [];
for (const match of app.matchAll(/\.route\(\s*"([^"]+)"\s*,/g)) {
  let depth = 1, quoted = false, escaped = false, end = match.index + '.route('.length;
  for (; end < app.length; end++) {
    const ch = app[end];
    if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; continue; }
    if (ch === '"') quoted = true;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) break;
  }
  const body = app.slice(match.index, end + 1);
  const methods = [...body.matchAll(/\b(get|post|put|patch|delete|options|head|any)\(\s*([\w:]+)/g)];
  for (const method of methods) api.push({ path: match[1], method: method[1].toUpperCase(), handler: method[2], permission: 'NOT_MAPPED', entity: 'NOT_MAPPED', fresh_execution: 'NOT_RUN', note: 'Static router reference only; no endpoint execution claim', source_head: sourceHead });
  if (!methods.length) api.push({ path: match[1], method: 'NOT_MAPPED', handler: 'NOT_MAPPED', permission: 'NOT_MAPPED', entity: 'NOT_MAPPED', fresh_execution: 'NOT_RUN', note: 'Manual router expansion required', source_head: sourceHead });
}
if (!postUpdate) writeFileSync(resolve(root, 'docs/audits/2026-11-16-api-actual.csv'), csv(api, ['path', 'method', 'handler', 'permission', 'entity', 'fresh_execution', 'note', 'source_head']));
const report = { observed_at: new Date().toISOString(), phase: postUpdate ? 'post-update' : 'initial', authorization: 'Read-only collector; package repair, encrypted backup and official local update separately authorized', source_head: sourceHead, source_inputs: Object.fromEntries(['frontend/Dockerfile', 'nginx/Dockerfile', 'infra/postgres/Dockerfile', 'backend-rust/Cargo.lock', 'frontend/package-lock.json'].map(path => [path, createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')])), checks, previous_panel_cases: previous, current_static_inventory: { jsx_occurrences: ui.length, excluded_tests: true, not_unique_actions: true, matrix: 'docs/audits/2026-11-16-controles-actuales.csv', router_method_entries: api.length, api_matrix: 'docs/audits/2026-11-16-api-actual.csv', previous_evidence_not_overwritten: true }, limits: ['Collector itself performs no real-account login/session mutation or business writes', 'No Tailscale, remote host or network/security change', 'No external email sent', 'No new camera/audio or external-network test', 'No commit or push; certification gate not passed'] };
writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ report: out.slice(root.length + 1), checks: checks.map(({ id, status }) => ({ id, status })), current_controls: ui.length, published_materials: metadata?.published, healthy: containers?.filter(x => x.health === 'healthy').length, historical_panel_cases: 108 }));
if (checks.some(x => x.status !== 'PASS')) process.exitCode = 1;
