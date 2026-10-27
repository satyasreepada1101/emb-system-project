// Frontend-only normalisation of raw microphone activity for display.
// The ESP32 reports raw values (average peak-to-peak ADC counts); these
// percentages are derived here and are labelled "relative level" in the UI.
//
//   relative % = clamp( (activity − noiseFloor) / (2 × (threshold − noiseFloor)) × 100, 0, 100 )
//
// So 0 % = calibrated noise floor, 50 % = that mic's detection threshold,
// 100 % = twice the threshold margin above the noise floor (or more).

import type { MicQuad } from '../types/protocol';

export const MICS = [
  { id: 1, label: 'Mic 1', angle: 0 },
  { id: 2, label: 'Mic 2', angle: 60 },
  { id: 3, label: 'Mic 3', angle: 120 },
  { id: 4, label: 'Mic 4', angle: 180 },
] as const;

export const micName = (id: number): string => {
  const mic = MICS.find((m) => m.id === id);
  return mic ? `${mic.label} (${mic.angle}°)` : `Mic ${id}`;
};

/** ADC is 12-bit, so peak-to-peak can never exceed 4095 counts. */
export const ADC_FULL_SCALE = 4095;

export function relativeLevel(activity: number, noiseFloor: number, threshold: number): number {
  const margin = Math.max(1, threshold - noiseFloor);
  const pct = ((activity - noiseFloor) / (2 * margin)) * 100;
  return Math.min(100, Math.max(0, pct));
}

/** Relative levels for all four mics, or null when calibration data is missing. */
export function relativeLevels(
  activity: MicQuad | null,
  noiseFloors: MicQuad | null,
  thresholds: MicQuad | null,
): MicQuad | null {
  if (!activity || !noiseFloors || !thresholds) return null;
  return activity.map((a, i) => relativeLevel(a, noiseFloors[i], thresholds[i])) as MicQuad;
}

/** Overall live sound level = loudest relative mic level (0–100). */
export function overallLevel(levels: MicQuad | null): number | null {
  return levels ? Math.max(...levels) : null;
}
