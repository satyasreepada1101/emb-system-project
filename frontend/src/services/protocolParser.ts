import type {
  CommandAck,
  EnableSource,
  Hello,
  IncomingMessage,
  MicQuad,
  Telemetry,
} from '../types/protocol';

// Pure module (type-only imports) so it can be unit tested with plain Node.

export type ParseResult =
  | { ok: true; message: IncomingMessage }
  | { ok: false; error: string };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

function quad(v: unknown, field: string): MicQuad | null {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v) || v.length !== 4 || !v.every((x) => isNum(x) && x >= 0)) {
    throw new Error(`${field} must be an array of four non-negative numbers or null`);
  }
  return [v[0], v[1], v[2], v[3]];
}

function bool(o: Obj, field: string): boolean {
  if (typeof o[field] !== 'boolean') throw new Error(`${field} must be boolean`);
  return o[field] as boolean;
}

function num(o: Obj, field: string): number {
  if (!isNum(o[field])) throw new Error(`${field} must be a number`);
  return o[field] as number;
}

function nullableNum(o: Obj, field: string, min: number, max: number): number | null {
  const v = o[field];
  if (v === null || v === undefined) return null;
  if (!isNum(v) || v < min || v > max) {
    throw new Error(`${field} must be a number in ${min}–${max} or null`);
  }
  return v;
}

function parseTelemetry(o: Obj): Telemetry {
  const strongest = nullableNum(o, 'strongestMic', 1, 4);
  if (strongest !== null && !Number.isInteger(strongest)) {
    throw new Error('strongestMic must be an integer 1–4 or null');
  }
  const source = o.enableSource;
  const enableSource: EnableSource =
    source === 'button' || source === 'web' || source === 'boot' ? source : 'boot';

  return {
    type: 'telemetry',
    sequence: num(o, 'sequence'),
    uptimeMs: num(o, 'uptimeMs'),
    systemEnabled: bool(o, 'systemEnabled'),
    enableSource,
    calibrating: bool(o, 'calibrating'),
    calibrated: typeof o.calibrated === 'boolean' ? o.calibrated : !o.calibrating,
    calibrationProgress: isNum(o.calibrationProgress)
      ? Math.min(100, Math.max(0, o.calibrationProgress))
      : 0,
    soundDetected: bool(o, 'soundDetected'),
    measurementCount: isNum(o.measurementCount) ? o.measurementCount : 0,
    micActivity: quad(o.micActivity, 'micActivity'),
    micThresholds: quad(o.micThresholds, 'micThresholds'),
    micNoiseFloors: quad(o.micNoiseFloors, 'micNoiseFloors'),
    estimatedAngle: nullableNum(o, 'estimatedAngle', 0, 180),
    smoothedAngle: nullableNum(o, 'smoothedAngle', 0, 180),
    strongestMic: strongest as Telemetry['strongestMic'],
    servoTarget: nullableNum(o, 'servoTarget', 0, 180),
    led1On: bool(o, 'led1On'),
    led2On: bool(o, 'led2On'),
    rssi: isNum(o.rssi) ? o.rssi : null,
  };
}

function parseHello(o: Obj): Hello {
  return {
    type: 'hello',
    device: o.device === 'esp32' ? 'esp32' : 'simulator',
    firmware: typeof o.firmware === 'string' ? o.firmware : 'unknown',
    telemetryIntervalMs: isNum(o.telemetryIntervalMs) ? o.telemetryIntervalMs : 200,
    micAngles: Array.isArray(o.micAngles) ? o.micAngles.filter(isNum) : [],
  };
}

function parseAck(o: Obj): CommandAck {
  if (typeof o.commandId !== 'string' || o.commandId.length === 0) {
    throw new Error('commandId must be a non-empty string');
  }
  return {
    type: 'commandAck',
    commandId: o.commandId,
    accepted: bool(o, 'accepted'),
    systemEnabled: bool(o, 'systemEnabled'),
    message: typeof o.message === 'string' ? o.message : '',
  };
}

/** Safely parse and validate one WebSocket text frame. Never throws. */
export function parseIncoming(raw: unknown): ParseResult {
  if (typeof raw !== 'string') return { ok: false, error: 'Non-text frame' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Invalid JSON' };
  }
  if (!isObj(data)) return { ok: false, error: 'Message is not a JSON object' };

  try {
    switch (data.type) {
      case 'telemetry':
        return { ok: true, message: parseTelemetry(data) };
      case 'hello':
        return { ok: true, message: parseHello(data) };
      case 'commandAck':
        return { ok: true, message: parseAck(data) };
      case 'error':
        return {
          ok: true,
          message: {
            type: 'error',
            message: typeof data.message === 'string' ? data.message : 'Unknown device error',
          },
        };
      default:
        return { ok: false, error: `Unsupported message type: ${String(data.type)}` };
    }
  } catch (err) {
    return { ok: false, error: `Invalid ${String(data.type)}: ${(err as Error).message}` };
  }
}
