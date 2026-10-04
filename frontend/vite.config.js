import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { randomUUID, createHash } from 'node:crypto'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ThemeProvider } from 'next-themes'
import { defineConfig } from 'vite'
import { THEME_OPTIONS } from './src/lib/themeConfig'

const apiProxyTarget = process.env.VITE_DEV_PROXY_API_ORIGIN || 'http://127.0.0.1:8000'
const wsProxyTarget = process.env.VITE_DEV_PROXY_WS_ORIGIN || 'ws://127.0.0.1:8000'
const mediaProxyTarget = process.env.VITE_DEV_PROXY_MEDIA_ORIGIN || apiProxyTarget
// The HTML and lazy chunks share this identity; recovery compares it with version.json.
const buildId = randomUUID()
// Keep next-themes' own initializer, served as a hashed external script so the
// prerendered page works with the existing CSP without allowing inline scripts.
const themeMarkup = renderToStaticMarkup(React.createElement(ThemeProvider, THEME_OPTIONS))
const themeScript = themeMarkup.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1]
if (!themeScript) throw new Error('Missing next-themes initializer')
const themeScriptFile = `assets/theme-init-${createHash('sha256').update(themeScript).digest('hex').slice(0, 16)}.js`

// https://vite.dev/config/
export default defineConfig({
  logLevel: 'error',
  base: '/',
  css: {
    modules: {
      generateScopedName(name, filename) {
        // The prerenderer and client build must produce the same class names,
        // independently of development transforms and absolute build paths.
        const source = path.relative(__dirname, filename).split(path.sep).join('/');
        return `_${name}_${createHash('sha256').update(source + ':' + name).digest('hex').slice(0, 8)}`;
      },
    },
  },
  define: { __APP_BUILD_ID__: JSON.stringify(buildId), __THEME_INIT_URL__: JSON.stringify('/' + themeScriptFile) },
  test: { include: ['src/**/*.test.{ts,tsx}'] },
  plugins: [react(), tailwindcss(), {
    name: 'uasspain-release',
    transformIndexHtml() {
      // Resolve the saved preference before the document can paint. Use the
      // provider's own initializer and keep the existing external-script CSP.
      return [{ tag: 'script', attrs: { src: '/' + themeScriptFile }, injectTo: 'head-prepend' }];
    },
    configureServer(server) {
      server.middlewares.use('/' + themeScriptFile, (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(themeScript);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ buildId }) })
      this.emitFile({ type: 'asset', fileName: themeScriptFile, source: themeScript })
    },
  }],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    manifest: true,
    // Las rutas lazy conservan code splitting automatico. No forzar chunks por
    // nombre de paquete: puede crear ciclos vendor <-> React y romper el arranque.
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      '/ws': {
        target: wsProxyTarget,
        ws: true,
        changeOrigin: true,
      },
      '/media': {
        target: mediaProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
