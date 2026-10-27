// TypeScript port of the firmware's amplitude-based direction algorithm.
// Used ONLY by demo mode (to produce plausible simulated values) and by
// unit tests. In hardware mode the dashboard displays what the ESP32 reports
// and never recomputes the direction itself.
//
// Keep in sync with firmware/sound_direction_finder/sound_direction_finder.ino.

import type { MicQuad } from '../types/protocol';

export const MIC_ANGLES: MicQuad = [0, 60, 120, 180];

export const MIN_THRESHOLD = 180;
export const MIN_NOISE_MARGIN = 100;
export const NOISE_MULTIPLIER = 1.35;
export const SMOOTHING_FACTOR = 0.35;
export const MIN_ANGLE_CHANGE = 5;
export const REQUIRED_DETECTIONS = 2;
export const SERVO_MIN_ANGLE = 10;
export const SERVO_MAX_ANGLE = 170;

/** Same as finishCalibration(): median noise floor plus margin. */
export function calibrate(samples: number[]): { noiseFloor: number; threshold: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length / 2)];
  const margin = Math.max(MIN_NOISE_MARGIN, Math.trunc(noiseFloor * (NOISE_MULTIPLIER - 1)));
  return { noiseFloor, threshold: Math.max(MIN_THRESHOLD, noiseFloor + margin) };
}

export interface Estimate {
  angle: number;
  /** 0-based index of the strongest qualifying microphone. */
  strongest: number;
}

/** Same as estimateDirection() in the firmware. */
export function estimateDirection(
  activity: MicQuad,
  thresholds: MicQuad,
  noiseFloors: MicQuad,
): Estimate | null {
  const strength = [0, 0, 0, 0];
  let strongest = -1;
  let strongestStrength = 0;

  for (let i = 0; i < 4; i++) {
    if (activity[i] > thresholds[i]) {
      strength[i] = activity[i] - noiseFloors[i];
      if (strength[i] > strongestStrength) {
        strongestStrength = strength[i];
        strongest = i;
      }
    }
  }

  if (strongest < 0) return null;

  let angle = MIC_ANGLES[strongest];
  let neighbour = -1;

  if (strongest > 0 && strength[strongest - 1] > 0) neighbour = strongest - 1;
  if (strongest < 3 && strength[strongest + 1] > 0) {
    if (neighbour < 0 || strength[strongest + 1] > strength[neighbour]) neighbour = strongest + 1;
  }

  if (neighbour >= 0) {
    const a = strength[strongest];
    const b = strength[neighbour];
    if (a + b > 0) angle += (b / (a + b)) * (MIC_ANGLES[neighbour] - MIC_ANGLES[strongest]);
  }

  return { angle: Math.min(180, Math.max(0, angle)), strongest };
}

/** Confirmation, smoothing and servo logic from finishListeningInterval(). */
export class DetectionPipeline {
  consecutiveDetections = 0;
  hasPreviousEstimate = false;
  smoothedAngle = 90;
  servoAngle = 90;

  resetConfirmation(): void {
    this.consecutiveDetections = 0;
  }

  process(estimate: Estimate | null): void {
    if (!estimate) {
      this.consecutiveDetections = 0;
      return;
    }
    this.consecutiveDetections++;
    if (this.consecutiveDetections < REQUIRED_DETECTIONS) return;
    this.consecutiveDetections = 0;

    if (!this.hasPreviousEstimate) {
      this.smoothedAngle = estimate.angle;
      this.hasPreviousEstimate = true;
    } else {
      this.smoothedAngle =
        SMOOTHING_FACTOR * estimate.angle + (1 - SMOOTHING_FACTOR) * this.smoothedAngle;
    }

    // C cast (int)(x + 0.5) truncates toward zero; x is always ≥ 0 here.
    const target = Math.min(
      SERVO_MAX_ANGLE,
      Math.max(SERVO_MIN_ANGLE, 180 - Math.trunc(this.smoothedAngle + 0.5)),
    );
    if (Math.abs(target - this.servoAngle) >= MIN_ANGLE_CHANGE) this.servoAngle = target;
  }
}
