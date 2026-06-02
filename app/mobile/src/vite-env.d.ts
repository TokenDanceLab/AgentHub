/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HUB_HEALTH_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
