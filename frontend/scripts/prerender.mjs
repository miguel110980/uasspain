import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';

// Render the actual public route components. No provider credentials or private
// API data are read during a build; managed content remains live in the client.
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', ssr: { noExternal: ['react-router-dom', 'react-router'], resolve: { conditions: ['module', 'import', 'development'] } } });
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
try {
  const { MemoryRouter } = await server.ssrLoadModule('react-router-dom');
  const source = await readFile('src/App.tsx', 'utf8');
  const modules = new Map([...source.matchAll(/const (\w+) = lazy\(\(\) => import\('([^']+)'\)\);/g)].map(m => [m[1], m[2]]));
  const routes = [...source.matchAll(/<Route path="([^"]+)" element=\{<(\w+)\s*\/>\}/g)]
    .filter(m => !m[1].includes(':') && !m[1].includes('*') && !/^\/(auth-redirect|elegir-panel|restablecer-contrasena)/.test(m[1]));
  if (routes.length < 20) throw new Error('Public route discovery failed; check App route declarations.');
  const { SITE, getSeoForPath, organizationJsonLd } = await server.ssrLoadModule('/src/lib/seoConfig.ts');
  const origin = new URL(SITE.url);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('VITE_SITE_URL must be a public origin.');
  const base = await readFile('dist/index.html', 'utf8');
  const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
  function preload(modulePath) {
    const visited = new Set();
    function collect(key) {
      if (visited.has(key)) return '';
      visited.add(key);
      const entry = manifest[key];
      if (!entry) return '';
      return `<link rel="modulepreload" href="/${entry.file}" />` + (entry.imports || []).map(collect).join('');
    }
    return collect(`src/${modulePath.replace(/^\.\//, '')}`);
  }
  const shell = base.replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(/<meta[^>]+(?:name="(?:description|keywords|robots|twitter:[^"]+)"|property="og:[^"]+")[^>]*>/g, '')
    .replace(/<link[^>]+rel="canonical"[^>]*>/g, '');
  function documentFor(route, body, seo) {
    const canonical = `${origin.origin}${route === '/' ? '/' : route}`;
    const head = `<title>${escape(seo.title)}</title>
      <meta name="description" content="${escape(seo.description)}" />
      <meta name="robots" content="${seo.noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'}" />
      <link rel="canonical" href="${escape(canonical)}" />
      <meta property="og:type" content="website" /><meta property="og:site_name" content="${SITE.name}" />
      <meta property="og:title" content="${escape(seo.title)}" /><meta property="og:description" content="${escape(seo.description)}" />
      <meta property="og:url" content="${escape(canonical)}" /><meta property="og:locale" content="${SITE.locale}" />
      <meta property="og:image" content="${escape(origin.origin + SITE.ogImage)}" />
      <meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="${escape(seo.title)}" />
      <meta name="twitter:description" content="${escape(seo.description)}" /><meta name="twitter:image" content="${escape(origin.origin + SITE.ogImage)}" />
      ${seo.noindex ? '' : `<script id="seo-org-jsonld" type="application/ld+json">${json({ '@context': 'https://schema.org', '@graph': [organizationJsonLd(), { '@type': 'WebSite', name: SITE.name, url: origin.origin }] })}</script>`}`;
    return shell.replace('</head>', `${head}</head>`)
      .replace(/<div id="root">[\s\S]*?<\/div>\s*<noscript>/, `<div id="root">${body}</div><noscript>`)
      .replace('UASSPAIN necesita JavaScript para funcionar.', 'Activa JavaScript para acceder a tu cuenta y al contenido actualizado.');
  }
  const urls = [];
  for (const [, route, name] of routes) {
    const modulePath = modules.get(name);
    if (!modulePath) throw new Error(`No component module for ${route}`);
    const { default: Page } = await server.ssrLoadModule(`/src/${modulePath.replace(/^\.\//, '')}`);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const body = renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [route] },
      React.createElement(ThemeProvider, { attribute: 'class', defaultTheme: 'dark', enableSystem: false },
        React.createElement(QueryClientProvider, { client }, React.createElement(Page)))))
      // In-view animations must not hide the server-rendered text without JS.
      .replace(/opacity:0(?=;|")/g, 'opacity:1')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
    client.clear();
    if (!/<h1\b/.test(body)) throw new Error(`Public page ${route} has no H1.`);
    const seo = getSeoForPath(route);
    const folder = path.join('dist', route.slice(1));
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'index.html'), documentFor(route, body, seo).replace('</head>', `${preload(modulePath)}</head>`));
    if (!seo.noindex) urls.push(`${origin.origin}${route === '/' ? '/' : route}`);
  }
  const loading = '<main><p role="status">Cargando UASSPAIN…</p></main>';
  await writeFile('dist/app.html', documentFor('/', loading, { title: 'Acceso | UASSPAIN', description: 'Acceso a la plataforma UASSPAIN.', noindex: true }));
  await writeFile('dist/course.html', shell.replace('</head>', '<!--#include virtual="/_course-head?slug=$course_slug" --></head>')
    .replace(/<div id="root">[\s\S]*?<\/div>\s*<noscript>/, '<div id="root"><!--#include virtual="/_course-body?slug=$course_slug" --></div><noscript>')
    .replace('UASSPAIN necesita JavaScript para funcionar.', 'Activa JavaScript para acceder a tu cuenta.'));
  await writeFile('dist/404.html', documentFor('/404', '<main><h1>Página no encontrada</h1><p>La página solicitada no existe.</p><a href="/">Volver al inicio</a></main>', { title: 'Página no encontrada | UASSPAIN', description: 'La página solicitada no existe.', noindex: true }));
  await writeFile('dist/sitemap-static.xml', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<url><loc>${escape(url)}</loc></url>`).join('')}</urlset>`);
  await writeFile('dist/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${origin.origin}/sitemap-static.xml</loc></sitemap><sitemap><loc>${origin.origin}/sitemap-courses.xml</loc></sitemap></sitemapindex>`);
  const robots = await readFile('public/robots.txt', 'utf8');
  await writeFile('dist/robots.txt', robots.replace(/^Sitemap:.*$/m, `Sitemap: ${origin.origin}/sitemap.xml`));
  console.log(`Prerendered ${routes.length} actual public pages; ${urls.length} indexable URLs.`);
} finally { await server.close(); }
