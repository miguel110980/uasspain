import react from '@vitejs/plugin-react'
import path from 'path'
import { randomUUID } from 'node:crypto'
import { defineConfig } from 'vite'

const apiProxyTarget = process.env.VITE_DEV_PROXY_API_ORIGIN || 'http://127.0.0.1:8000'
const wsProxyTarget = process.env.VITE_DEV_PROXY_WS_ORIGIN || 'ws://127.0.0.1:8000'
const mediaProxyTarget = process.env.VITE_DEV_PROXY_MEDIA_ORIGIN || apiProxyTarget
const buildId = randomUUID()

// https://vite.dev/config/
export default defineConfig({
  logLevel: 'error',
  base: '/',
  define: { __APP_BUILD_ID__: JSON.stringify(buildId) },
  test: { include: ['src/**/*.test.{ts,tsx}'] },
  plugins: [react(), {
    name: 'uasspain-release',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ buildId }) })
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
