import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:8011',
    browserName: 'chromium',
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 8011 --strictPort',
    url: 'http://127.0.0.1:8011',
    reuseExistingServer: false,
    env: {
      VITE_DEV_PROXY_API_ORIGIN: 'http://127.0.0.1:8010',
      VITE_DEV_PROXY_WS_ORIGIN: 'ws://127.0.0.1:8010',
      VITE_DEV_PROXY_MEDIA_ORIGIN: 'http://127.0.0.1:8012',
    },
  },
});
