import { readFile } from 'node:fs/promises';
import https from 'node:https';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

// Exercise the compiled site through the edge proxy with real TLS verification.
const target = new URL(process.env.SITE_TEST_URL || 'https://localhost:8445');
assert.equal(target.protocol, 'https:');
const ca = await readFile(process.env.SITE_TEST_CA || '.secrets/tls/ca.crt');
function get(path) {
  return new Promise((resolve, reject) => {
    const request = https.get(new URL(path, target), { ca, timeout: 10000, headers: { 'Accept-Encoding': 'gzip' } }, response => {
      const chunks = [];
      response.on('data', chunk => { chunks.push(chunk); });
      response.on('end', () => {
        const bytes = Buffer.concat(chunks);
        const body = (response.headers['content-encoding'] === 'gzip' ? gunzipSync(bytes) : bytes).toString('utf8');
        resolve({ status: response.statusCode, headers: response.headers, body });
      });
    });
    request.on('timeout', () => request.destroy(new Error('HTTPS request timed out')));
    request.on('error', reject);
  });
}
const sitemap = await get('/sitemap-static.xml');
assert.equal(sitemap.status, 200);
const paths = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => new URL(match[1]).pathname);
assert.ok(paths.length >= 10, 'Static sitemap must contain the public routes');
const titles = new Set();
for (const path of paths) {
  const response = await get(path);
  assert.equal(response.status, 200, path);
  assert.match(response.body, /<h1\b/, path);
  assert.match(response.body, /<link rel="canonical"/, path);
  assert.doesNotMatch(response.body, /href="\/#formacion"/, `Broken formation backlink: ${path}`);
  assert.match(response.headers['content-security-policy'], /frame-ancestors/, path);
  const title = response.body.match(/<title>([^<]+)<\/title>/)?.[1];
  assert.ok(title && !titles.has(title), `Missing or duplicate title: ${path}`);
  titles.add(title);
}
for (const path of ['/servicios', '/servicios/']) {
  const response = await get(path);
  assert.equal(response.status, 301, path);
  assert.equal(response.headers.location, '/#servicios', path);
  const destination = await get(new URL(response.headers.location, target).pathname);
  assert.equal(destination.status, 200, path);
  assert.match(destination.body, /id="servicios"/, path);
}
for (const path of [
  '/ruta-inexistente-verificacion', '/formacion/curso-inexistente-verificacion',
  '/auth-redirect', '/auth-redirect/',
  ...['admin', 'instructor', 'alumno', 'elegir-panel', 'restablecer-contrasena']
    .flatMap(route => [`/${route}/no-existe`, `/${route}/no-existe/`]),
]) {
  const response = await get(path);
  assert.equal(response.status, 404, path);
  assert.match(response.headers['x-robots-tag'], /noindex/, path);
}
for (const path of [
  ...['admin', 'instructor', 'alumno', 'elegir-panel', 'restablecer-contrasena']
    .flatMap(route => [`/${route}`, `/${route}/`]),
  '/?auth=login', '/api/health/live/',
]) {
  const response = await get(path);
  assert.equal(response.status, 200, path);
  assert.match(response.headers['x-robots-tag'], /noindex/, path);
}
const courses = await get('/sitemap-courses.xml');
assert.equal(courses.status, 200);
for (const match of courses.body.matchAll(/<loc>([^<]+)<\/loc>/g)) {
  const response = await get(new URL(match[1]).pathname);
  assert.equal(response.status, 200);
  assert.match(response.body, /<h1\b/);
  assert.match(response.body, /<title>[^<]+<\/title>/);
  assert.match(response.body, /<link rel="canonical"/);
  assert.match(response.body, /"@type":"Course"/);
  assert.doesNotMatch(response.body, /<!--#include|an error occurred/);
}
if (process.env.SSR_TEST_UNPUBLISHED_SLUG) {
  const slug = process.env.SSR_TEST_UNPUBLISHED_SLUG;
  assert.match(slug, /^[a-z0-9-]+$/);
  assert.equal((await get(`/formacion/${slug}`)).status, 404);
  assert.ok(!courses.body.includes(`/formacion/${slug}<`));
}
console.log(`PASS: ${paths.length} static pages, unique titles, service redirects, formation backlinks, private noindex, strict 404, published courses and verified HTTPS.`);
