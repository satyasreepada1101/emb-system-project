/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ESP32_WS_URL?: string;
  readonly VITE_TELEMETRY_STALE_MS?: string;
  readonly VITE_COMMAND_TIMEOUT_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
