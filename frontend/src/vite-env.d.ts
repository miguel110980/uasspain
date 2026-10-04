/// <reference types="vite/client" />
declare const __APP_BUILD_ID__: string;
declare const __THEME_INIT_URL__: string;

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
