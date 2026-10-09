import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
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
  for (const [, alias, fallback] of source.matchAll(/const (\w+) = \w+ \|\| (\w+);/g)) {
    if (modules.has(fallback)) modules.set(alias, modules.get(fallback));
  }
  const routes = [...source.matchAll(/<Route path="([^"]+)" element=\{<(\w+)\s*\/>\}/g)]
    .filter(m => !m[1].includes(':') && !m[1].includes('*') && !/^\/(elegir-panel|restablecer-contrasena)/.test(m[1]));
  if (!['/', '/formacion', '/contacto', '/nosotros'].every(route => routes.some(match => match[1] === route))) throw new Error('Public route discovery failed; check App route declarations.');
  const { SITE, getSeoForPath, organizationJsonLd } = await server.ssrLoadModule('/src/lib/seoConfig.ts');
  const { AppProviders } = await server.ssrLoadModule('/src/App.tsx');
  const { THEME_OPTIONS } = await server.ssrLoadModule('/src/lib/themeConfig.ts');
  const origin = new URL(SITE.url);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('VITE_SITE_URL must be a public origin.');
  const base = await readFile('dist/index.html', 'utf8');
  const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
  function preload(modulePath, priority = 'auto', scripts = true) {
    const visited = new Set();
    const styles = new Set([...base.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(match => match[1]));
    function collect(key) {
      if (visited.has(key)) return '';
      visited.add(key);
      const entry = manifest[key];
      if (!entry) return '';
      const css = (entry.css || []).filter(file => {
        const href = `/${file}`;
        if (styles.has(href)) return false;
        styles.add(href);
        return true;
      }).map(file => `<link rel="stylesheet" crossorigin href="/${file}" />`).join('');
      return css + (scripts ? `<link rel="modulepreload" href="/${entry.file}" fetchpriority="${priority}" />` : '') + (entry.imports || []).map(collect).join('');
    }
    const source = `src/${modulePath.replace(/^\.\//, '')}`;
    const key = [source, `${source}.tsx`, `${source}.ts`].find(candidate => manifest[candidate]);
    if (!key) throw new Error(`No build manifest entry for public page: ${source}`);
    return collect(key);
  }
  // The photo is used only by Home. Private entry points and other public
  // routes share this template, but must not download an unused hero image.
  const heroPreloadPattern = /<link\b(?=[^>]*\brel="preload")(?=[^>]*\bas="image")(?=[^>]*\bhref="\/images\/hero_claro\.webp")[^>]*>/g;
  const heroPreloads = [...base.matchAll(heroPreloadPattern)].map(match => match[0]).join('');
  const shell = base.replace(heroPreloadPattern, '').replace(/<title>[\s\S]*?<\/title>/, '')
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
    return shell.replace('</head>', `${head}${route === '/' && !seo.noindex ? heroPreloads : ''}</head>`)
      .replace(/<div id="root">[\s\S]*?<\/div>\s*<noscript>/, `<div id="root">${body}</div><noscript>`)
      .replace('UASSPAIN necesita JavaScript para funcionar.', 'Activa JavaScript para acceder a tu cuenta y al contenido actualizado.');
  }
  const urls = [];
  for (const [, route, name] of routes) {
    const modulePath = modules.get(name);
    if (!modulePath) throw new Error(`No component module for ${route}`);
    const { default: Page } = await server.ssrLoadModule(`/src/${modulePath.replace(/^\.\//, '')}`);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const page = React.createElement(MemoryRouter, { initialEntries: [route] },
      React.createElement(ThemeProvider, THEME_OPTIONS,
        React.createElement(QueryClientProvider, { client }, React.createElement(Page))));
    const markup = route === '/' ? renderToString(React.createElement(AppProviders, { client },
      React.createElement(MemoryRouter, { initialEntries: [route] },
        React.createElement(React.Suspense, null, React.createElement(Page))))) : renderToStaticMarkup(page);
    const body = markup
      // In-view animations must not hide the server-rendered text without JS.
      .replace(/opacity:0(?=;|")/g, 'opacity:1')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, route === '/' ? match => match : '');
    client.clear();
    if (!/<h1\b/.test(body)) throw new Error(`Public page ${route} has no H1.`);
    const seo = getSeoForPath(route);
    const folder = path.join('dist', route.slice(1));
    await mkdir(folder, { recursive: true });
    let html = documentFor(route, body, seo).replace('</head>', `${preload(modulePath, 'auto', route !== '/')}</head>`);
    if (route === '/') {
      html = html.replace('<div id="root">', '<div id="root" data-prerendered="home">');
      // Use the actual compiled CSS: avoid extra render-blocking round trips
      // while keeping the same styles and a single source of truth.
      for (const match of [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/g)]) {
        let css = await readFile(path.join('dist', match[1].replace(/^\//, '')), 'utf8');
        // Deliver critical Latin fonts with the initial document. Their original
        // files remain the source of truth and fallback for other public routes.
        for (const font of [...css.matchAll(/url\((\/fonts\/[^)]+-critical\.woff2)\)/g)]) {
          const bytes = await readFile(path.join('dist', font[1].slice(1)));
          css = css.replaceAll(font[0], `url(data:font/woff2;base64,${bytes.toString('base64')})`);
        }
        // Vite recognizes the stylesheet link during subsequent lazy imports.
        // Its compiled contents are already applied inline; disable only the
        // duplicate external load, which would otherwise block rendering again.
        html = html.replace(match[0], `<style data-stylesheet="${match[1]}">${css.replace(/<\/style/gi, '<\\/style')}</style>`);
      }
      html = html.replace(/<link[^>]+rel="preload"[^>]+href="\/fonts\/[^\"]+"[^>]*>/g, '');
    }
    await writeFile(path.join(folder, 'index.html'), html);
    if (!seo.noindex) urls.push(`${origin.origin}${route === '/' ? '/' : route}`);
  }
  const loading = '<main><p role="status">Cargando UASSPAIN…</p></main>';
  await writeFile('dist/app.html', documentFor('/', loading, { title: 'Acceso | UASSPAIN', description: 'Acceso a la plataforma UASSPAIN.', noindex: true }));
  await writeFile('dist/course.html', shell.replace('</head>', `${preload(modules.get('CursoDinamico'))}<!--#include virtual="/_course-head?slug=$course_slug" --></head>`)
    .replace(/<div id="root">[\s\S]*?<\/div>\s*<noscript>/, '<div id="root"><!--#include virtual="/_course-body?slug=$course_slug" --></div><noscript>')
    .replace('UASSPAIN necesita JavaScript para funcionar.', 'Activa JavaScript para acceder a tu cuenta.'));
  await writeFile('dist/404.html', documentFor('/404', '<main><h1>Página no encontrada</h1><p>La página solicitada no existe.</p><a href="/">Volver al inicio</a></main>', { title: 'Página no encontrada | UASSPAIN', description: 'La página solicitada no existe.', noindex: true }));
  await writeFile('dist/sitemap-static.xml', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<url><loc>${escape(url)}</loc></url>`).join('')}</urlset>`);
  await writeFile('dist/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${origin.origin}/sitemap-static.xml</loc></sitemap><sitemap><loc>${origin.origin}/sitemap-courses.xml</loc></sitemap></sitemapindex>`);
  const robots = await readFile('public/robots.txt', 'utf8');
  await writeFile('dist/robots.txt', robots.replace(/^Sitemap:.*$/m, `Sitemap: ${origin.origin}/sitemap.xml`));
  console.log(`Prerendered ${routes.length} actual public pages; ${urls.length} indexable URLs.`);
} finally { await server.close(); }
