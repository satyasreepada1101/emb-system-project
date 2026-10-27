// Runtime configuration. The WebSocket URL comes from VITE_ESP32_WS_URL
// (frontend/.env.local) and can be overridden in the dashboard's
// Connection Settings panel, which is remembered in this browser.

const env = import.meta.env;

function envNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Placeholder only: replace with the IP your ESP32 prints in Serial Monitor. */
export const EXAMPLE_WS_URL = 'ws://192.168.1.120:81';

export const DEFAULT_WS_URL = env.VITE_ESP32_WS_URL?.trim() || EXAMPLE_WS_URL;
export const DEFAULT_STALE_MS = envNumber(env.VITE_TELEMETRY_STALE_MS, 1500);
export const COMMAND_TIMEOUT_MS = envNumber(env.VITE_COMMAND_TIMEOUT_MS, 3000);

export function isValidWsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'ws:' || url.protocol === 'wss:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

// localStorage may be unavailable (private mode, blocked storage); never fail.
export function loadSetting(key: string): string | null {
  try {
    return window.localStorage.getItem(`sdf.${key}`);
  } catch {
    return null;
  }
}

export function saveSetting(key: string, value: string): void {
  try {
    window.localStorage.setItem(`sdf.${key}`, value);
  } catch {
    /* ignore */
  }
}

export function makeCommandId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // crypto.randomUUID is missing on plain-http non-localhost origins.
  return `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
