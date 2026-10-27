/**
 * WebSocket JSON protocol shared with the ESP32 firmware
 * (firmware/sound_direction_finder/sound_direction_finder.ino).
 * Full field documentation: docs/PROTOCOL.md
 */

/** Four values ordered Mic 1 (0°), Mic 2 (60°), Mic 3 (120°), Mic 4 (180°). */
export type MicQuad = [number, number, number, number];

export type EnableSource = 'boot' | 'button' | 'web';

/** ESP32 → browser, every ~200 ms and immediately after state changes. */
export interface Telemetry {
  type: 'telemetry';
  /** Increments by one for every telemetry message produced. */
  sequence: number;
  /** ESP32 uptime (millis()), milliseconds. */
  uptimeMs: number;
  systemEnabled: boolean;
  /** What last changed systemEnabled. */
  enableSource: EnableSource;
  calibrating: boolean;
  /** True once noise calibration has completed at least once. */
  calibrated: boolean;
  /** 0–100 %. */
  calibrationProgress: number;
  /** Latest completed 500 ms listening interval contained a qualifying sound. */
  soundDetected: boolean;
  /** Number of completed listening intervals since boot. */
  measurementCount: number;
  /** Average peak-to-peak ADC counts (12-bit) over the latest 500 ms interval; null when unavailable. */
  micActivity: MicQuad | null;
  /** Calibrated detection thresholds, ADC p-p counts; null until calibrated. */
  micThresholds: MicQuad | null;
  /** Calibrated median noise floors, ADC p-p counts; null until calibrated. */
  micNoiseFloors: MicQuad | null;
  /** Interpolated direction of the latest interval, 0–180°; null with no qualifying sound. */
  estimatedAngle: number | null;
  /** Firmware's smoothed direction that drives the servo; null before the first confirmed detection. */
  smoothedAngle: number | null;
  /** Strongest qualifying microphone, 1–4; null with no qualifying sound. */
  strongestMic: 1 | 2 | 3 | 4 | null;
  /** Last angle written to the servo, degrees (10–170). */
  servoTarget: number | null;
  /** Commanded logical state of LED 1 (system enabled). */
  led1On: boolean;
  /** Commanded logical state of LED 2 (sound detected). */
  led2On: boolean;
  /** Wi-Fi signal strength, dBm. */
  rssi: number | null;
}

/** ESP32 → browser, once per connection. */
export interface Hello {
  type: 'hello';
  /** "esp32" for the real firmware, "simulator" for scripts/mock-esp32.mjs. */
  device: 'esp32' | 'simulator';
  firmware: string;
  telemetryIntervalMs: number;
  micAngles: number[];
}

/** ESP32 → browser, reply to a command. */
export interface CommandAck {
  type: 'commandAck';
  commandId: string;
  accepted: boolean;
  /** Confirmed state after the command was processed. */
  systemEnabled: boolean;
  message: string;
}

/** ESP32 → browser, for messages that could not be tied to a commandId. */
export interface DeviceError {
  type: 'error';
  message: string;
}

export type IncomingMessage = Telemetry | Hello | CommandAck | DeviceError;

/** Browser → ESP32. Sets (never toggles) the system state, so retries are safe. */
export interface SetSystemEnabledCommand {
  type: 'setSystemEnabled';
  commandId: string;
  enabled: boolean;
}
