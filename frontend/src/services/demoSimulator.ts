// DEMO MODE ONLY. Produces simulated telemetry in the same shape as the ESP32
// so the dashboard can be shown without hardware. Its output is always
// labelled DEMO in the UI and it never talks to a real device.

import type {
  CommandAck,
  EnableSource,
  MicQuad,
  SetSystemEnabledCommand,
  Telemetry,
} from '../types/protocol';
import {
  DetectionPipeline,
  MIC_ANGLES,
  calibrate,
  estimateDirection,
  type Estimate,
} from '../lib/directionAlgorithm.ts';

const LISTEN_MS = 500;

interface Scenario {
  soundOn: boolean;
  until: number;
  angle: number;
  amplitude: number;
}

export class DemoSimulator {
  private enabled = false;
  private source: EnableSource = 'boot';
  private calibrating = false;
  private calibrated = false;
  private calibrationStart = 0;
  private nextIntervalAt = 0;
  private sequence = 0;
  private measurementCount = 0;
  private startedAt = 0;
  private pipeline = new DetectionPipeline();
  private latest: { activity: MicQuad; estimate: Estimate | null } | null = null;
  private scenario: Scenario = { soundOn: false, until: 0, angle: 90, amplitude: 400 };

  /** Simulated room noise floors (ADC p-p counts) and the thresholds the firmware would derive. */
  readonly noiseFloors: MicQuad = [95, 110, 100, 90];
  readonly thresholds: MicQuad;

  private readonly calibrationMs: number;
  private readonly random: () => number;

  /** Demo calibration is shortened from the real 30 s so the demo is watchable. */
  constructor(calibrationMs = 4000, random: () => number = Math.random) {
    this.calibrationMs = calibrationMs;
    this.random = random;
    this.thresholds = this.noiseFloors.map(
      (floor) => calibrate(Array(150).fill(floor)).threshold,
    ) as MicQuad;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  start(now: number): void {
    this.startedAt = now;
    this.scenario.until = now + 1500;
    this.setEnabled(true, 'boot', now);
  }

  /** Same semantics as setSystemEnabled() in the firmware. */
  setEnabled(enabled: boolean, source: EnableSource, now: number): boolean {
    if (enabled === this.enabled) return false;
    this.enabled = enabled;
    this.source = source;
    this.latest = null;
    this.pipeline.resetConfirmation();
    if (enabled) {
      if (this.calibrated) {
        this.nextIntervalAt = now + LISTEN_MS;
      } else {
        this.calibrating = true;
        this.calibrationStart = now;
      }
    } else {
      this.calibrating = false;
    }
    return true;
  }

  handleCommand(command: SetSystemEnabledCommand, now: number): CommandAck {
    const changed = this.setEnabled(command.enabled, 'web', now);
    const verb = command.enabled ? 'enabled' : 'disabled';
    return {
      type: 'commandAck',
      commandId: command.commandId,
      accepted: true,
      systemEnabled: this.enabled,
      message: changed ? `System ${verb} (demo)` : `System already ${verb} (demo)`,
    };
  }

  advance(now: number): void {
    if (!this.enabled) return;

    if (this.calibrating) {
      if (now - this.calibrationStart >= this.calibrationMs) {
        this.calibrating = false;
        this.calibrated = true;
        this.nextIntervalAt = now + LISTEN_MS;
      }
      return;
    }

    // After the tab was in the background, skip ahead rather than replaying.
    if (now - this.nextIntervalAt > 4 * LISTEN_MS) this.nextIntervalAt = now;

    while (now >= this.nextIntervalAt) {
      this.runInterval(this.nextIntervalAt);
      this.nextIntervalAt += LISTEN_MS;
    }
  }

  snapshot(now: number): Telemetry {
    const live = this.enabled && !this.calibrating ? this.latest : null;
    const estimate = live?.estimate ?? null;
    const soundDetected = estimate !== null;
    const round1 = (v: number) => Math.round(v * 10) / 10;

    return {
      type: 'telemetry',
      sequence: ++this.sequence,
      uptimeMs: now - this.startedAt,
      systemEnabled: this.enabled,
      enableSource: this.source,
      calibrating: this.calibrating,
      calibrated: this.calibrated,
      calibrationProgress: this.calibrated
        ? 100
        : this.calibrating
          ? Math.min(99, Math.floor(((now - this.calibrationStart) / this.calibrationMs) * 100))
          : 0,
      soundDetected,
      measurementCount: this.measurementCount,
      micActivity: live ? live.activity : null,
      micThresholds: this.calibrated ? this.thresholds : null,
      micNoiseFloors: this.calibrated ? this.noiseFloors : null,
      estimatedAngle: estimate ? round1(estimate.angle) : null,
      smoothedAngle: this.pipeline.hasPreviousEstimate ? round1(this.pipeline.smoothedAngle) : null,
      strongestMic: estimate ? ((estimate.strongest + 1) as 1 | 2 | 3 | 4) : null,
      servoTarget: this.pipeline.servoAngle,
      led1On: this.enabled,
      led2On: this.enabled && !this.calibrating && soundDetected,
      rssi: null,
    };
  }

  private updateScenario(t: number): void {
    const s = this.scenario;
    if (t >= s.until) {
      if (s.soundOn) {
        s.soundOn = false;
        s.until = t + 1500 + this.random() * 2000;
      } else {
        s.soundOn = true;
        s.until = t + 3000 + this.random() * 3000;
        const jump = (20 + this.random() * 60) * (this.random() < 0.5 ? -1 : 1);
        let next = s.angle + jump;
        if (next < 5 || next > 175) next = s.angle - jump;
        s.angle = Math.min(175, Math.max(5, next));
        s.amplitude = 300 + this.random() * 250;
      }
    } else if (s.soundOn) {
      s.angle = Math.min(178, Math.max(2, s.angle + (this.random() - 0.5) * 6));
    }
  }

  private runInterval(t: number): void {
    this.updateScenario(t);
    const s = this.scenario;

    const activity = MIC_ANGLES.map((micAngle, i) => {
      const lobe = s.soundOn ? Math.exp(-(((s.angle - micAngle) / 45) ** 2)) : 0;
      const noise = (this.random() - 0.5) * 30;
      return Math.max(0, Math.round(this.noiseFloors[i] + noise + s.amplitude * lobe));
    }) as MicQuad;

    const estimate = estimateDirection(activity, this.thresholds, this.noiseFloors);
    this.pipeline.process(estimate);
    this.latest = { activity, estimate };
    this.measurementCount++;
  }
}
