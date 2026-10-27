import type { DataState, Mode } from './dashboardState';
import type { EnableSource, Telemetry } from '../types/protocol';

export type DetectionState = 'unavailable' | 'disabled' | 'calibrating' | 'active' | 'listening';

/** One definition of "what is the detector doing", shared by every panel. */
export function detectionStateOf(live: Telemetry | null): DetectionState {
  if (!live) return 'unavailable';
  if (!live.systemEnabled) return 'disabled';
  if (live.calibrating) return 'calibrating';
  if (live.soundDetected && live.estimatedAngle !== null) return 'active';
  return 'listening';
}

/** Rounded display of an angle; every panel uses this so the numbers always agree. */
export const formatAngle = (deg: number): string => `${Math.round(deg)}°`;

export function connectionText(mode: Mode, dataState: DataState): string {
  if (mode === 'demo') return 'ESP32 not used (demo)';
  switch (dataState) {
    case 'live':
      return 'ESP32 connected';
    case 'waiting':
      return 'Waiting for ESP32';
    case 'stale':
      return 'Telemetry stale';
    case 'connecting':
      return 'Connecting…';
    case 'paused':
      return 'Disconnected (paused)';
    default:
      return 'ESP32 disconnected';
  }
}

export function sourceText(source: EnableSource): string {
  switch (source) {
    case 'button':
      return 'physical button';
    case 'web':
      return 'website command';
    default:
      return 'power-on';
  }
}

export function agoText(ms: number): string {
  if (ms < 1000) return 'just now';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  return `${m} min ${s % 60} s ago`;
}

export function uptimeText(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}
