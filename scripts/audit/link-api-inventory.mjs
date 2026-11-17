/** Add source references without converting static references into test PASS. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const path = resolve(root, 'docs/audits/2026-11-16-api-actual.csv');
function parse(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (ch === ',' && !quoted) { row.push(cell); cell = ''; }
    else if (ch === '\n' && !quoted) { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const columns = rows.shift(); return rows.map(values => Object.fromEntries(columns.map((name, i) => [name, values[i] || ''])));
}
function sourceFunction(module, name) {
  if (!/^[a-z0-9_]+$/.test(module) || !/^[a-z0-9_]+$/.test(name)) return null;
  const source = `backend-rust/src/${module}.rs`;
  if (!existsSync(resolve(root, source))) return null;
  const text = readFileSync(resolve(root, source), 'utf8');
  const expression = new RegExp(`\\bfn\\s+${name}\\s*(?:<[^>]*>)?\\s*\\(`);
  const match = expression.exec(text);
  if (!match) return null;
  const remainder = text.slice(match.index);
  const next = /\n(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s/.exec(remainder.slice(match[0].length));
  return { source, line: text.slice(0, match.index).split('\n').length, text: remainder.slice(0, next ? next.index + match[0].length : undefined) };
}
const rows = parse(readFileSync(path, 'utf8'));
for (const row of rows) {
  const names = row.handler.split('::');
  const fn = names.at(-1); const module = names.length > 1 ? names.at(-2) : 'app';
  const found = sourceFunction(module, fn);
  row.handler_source = found?.source || 'NOT_MAPPED'; row.handler_line = found?.line || '';
  row.guard_refs = ''; row.scope_refs = ''; row.entity_refs = ''; row.mapping_status = 'NOT_MAPPED';
  if (found) {
    const roles = [...found.text.matchAll(/require_role\s*\(\s*&?claims\s*,\s*&?\[([^\]]+)\]/g)].flatMap(m => [...m[1].matchAll(/"(admin|instructor|alumno)"/g)].map(x => x[1]));
    const guards = [...new Set([...found.text.matchAll(/\b(authenticate|require_role|require_role_available|require_admin|admin)\s*\(/g)].map(x => x[1]))];
    row.guard_refs = guards.join(';');
    row.scope_refs = [...new Set([...found.text.matchAll(/academic_scope::([a-z0-9_]+)/g)].map(x => x[0]))].join(';');
    row.entity_refs = [...new Set([...found.text.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z][a-z0-9_]+)\b/g)].map(x => x[1]))].join(';');
    row.permission = roles.length ? 'SOURCE_LITERAL:' + [...new Set(roles)].join('|') : guards.length ? 'SOURCE_GUARD_REQUIRES_SEMANTIC_REVIEW' : 'NOT_MAPPED';
    row.entity = row.entity_refs ? 'SOURCE_SQL_CANDIDATES' : 'NOT_MAPPED';
    row.mapping_status = 'STATIC_PARTIAL_NOT_A_TEST';
  }
}
const columns = ['path', 'method', 'handler', 'handler_source', 'handler_line', 'permission', 'guard_refs', 'scope_refs', 'entity', 'entity_refs', 'mapping_status', 'fresh_execution', 'note', 'source_head'];
const quote = x => '"' + String(x ?? '').replaceAll('"', '""') + '"';
writeFileSync(path, [columns.map(quote).join(','), ...rows.map(row => columns.map(k => quote(row[k])).join(','))].join('\n') + '\n');
console.log(JSON.stringify({ rows: rows.length, handlers_found: rows.filter(x => x.handler_source !== 'NOT_MAPPED').length, literal_role_candidates: rows.filter(x => x.permission.startsWith('SOURCE_LITERAL:')).length, semantic_review_still_required: true, execution_results_unchanged: true }));
