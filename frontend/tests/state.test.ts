import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIncoming } from '../src/services/protocolParser.ts';
import { deriveView, initialState, reducer, type DashboardState } from '../src/lib/dashboardState.ts';
import { detectionStateOf } from '../src/lib/statusText.ts';
import type { Telemetry } from '../src/types/protocol.ts';

const sample = {
  type: 'telemetry',
  sequence: 100,
  uptimeMs: 120000,
  systemEnabled: true,
  enableSource: 'boot',
  calibrating: false,
  calibrated: true,
  calibrationProgress: 100,
  soundDetected: true,
  measurementCount: 50,
  micActivity: [120, 420, 190, 110],
  micThresholds: [180, 200, 180, 180],
  micNoiseFloors: [80, 90, 85, 70],
  estimatedAngle: 72.0,
  smoothedAngle: 70.4,
  strongestMic: 2,
  servoTarget: 108,
  led1On: true,
  led2On: true,
  rssi: -55,
};

function telemetry(overrides: Partial<Telemetry> = {}): Telemetry {
  const r = parseIncoming(JSON.stringify({ ...sample, ...overrides }));
  assert.ok(r.ok);
  return r.message as Telemetry;
}

function hardwareOpen(): DashboardState {
  let s = initialState('hardware', 'ws://test:81', 1500);
  s = reducer(s, { type: 'LINK', info: { status: 'open', attempt: 0, retryAt: null, error: null } });
  return s;
}

// ---- protocol parsing ----

test('parses the documented telemetry example', () => {
  const t = telemetry();
  assert.equal(t.estimatedAngle, 72);
  assert.deepEqual(t.micActivity, [120, 420, 190, 110]);
  assert.equal(t.strongestMic, 2);
});

test('rejects malformed frames without throwing', () => {
  assert.equal(parseIncoming('not json').ok, false);
  assert.equal(parseIncoming('[1,2]').ok, false);
  assert.equal(parseIncoming(JSON.stringify({ type: 'nope' })).ok, false);
  assert.equal(parseIncoming(JSON.stringify({ ...sample, micActivity: [1, 2, 3] })).ok, false);
  assert.equal(parseIncoming(JSON.stringify({ ...sample, estimatedAngle: 200 })).ok, false);
  assert.equal(parseIncoming(JSON.stringify({ ...sample, strongestMic: 5 })).ok, false);
  assert.equal(parseIncoming(JSON.stringify({ ...sample, systemEnabled: 'yes' })).ok, false);
  assert.equal(parseIncoming(JSON.stringify({ type: 'commandAck', accepted: true })).ok, false);
});

test('null estimatedAngle and micActivity are accepted', () => {
  const t = telemetry({ estimatedAngle: null, micActivity: null, strongestMic: null, soundDetected: false });
  assert.equal(t.estimatedAngle, null);
  assert.equal(detectionStateOf(t), 'listening');
});

// ---- view derivation ----

test('hardware: waiting → live → stale → disconnected', () => {
  let s = hardwareOpen();
  assert.equal(deriveView(s, 0).dataState, 'waiting');
  assert.equal(deriveView(s, 0).live, null, 'never invents telemetry');

  s = reducer(s, { type: 'TELEMETRY', telemetry: telemetry(), receivedAt: 1000 });
  assert.equal(deriveView(s, 1500).dataState, 'live');
  assert.equal(deriveView(s, 1500).live?.estimatedAngle, 72);

  const stale = deriveView(s, 3000);
  assert.equal(stale.dataState, 'stale');
  assert.equal(stale.live, null, 'stale readings are not presented as current');
  assert.equal(stale.canCommand, false);

  s = reducer(s, { type: 'LINK', info: { status: 'reconnecting', attempt: 1, retryAt: 5000, error: 'x' } });
  const v = deriveView(s, 3000);
  assert.equal(v.dataState, 'disconnected');
  assert.equal(v.live, null);
  assert.equal(s.lastUpdateAt, 1000, 'last successful update is kept for the status panel');
  assert.equal(s.lastDetection?.angle, 72, 'last detection kept as history');
});

test('disabled telemetry → radar/direction show disabled, never active', () => {
  const t = telemetry({ systemEnabled: false, soundDetected: false, estimatedAngle: null, led1On: false, led2On: false });
  assert.equal(detectionStateOf(t), 'disabled');
  assert.equal(detectionStateOf(telemetry({ calibrating: true })), 'calibrating');
  assert.equal(detectionStateOf(telemetry()), 'active');
  assert.equal(detectionStateOf(null), 'unavailable');
});

test('physical button change is reflected by the next telemetry', () => {
  let s = hardwareOpen();
  s = reducer(s, { type: 'TELEMETRY', telemetry: telemetry(), receivedAt: 1000 });
  s = reducer(s, {
    type: 'TELEMETRY',
    telemetry: telemetry({ systemEnabled: false, enableSource: 'button', soundDetected: false, estimatedAngle: null }),
    receivedAt: 1200,
  });
  const v = deriveView(s, 1300);
  assert.equal(v.live?.systemEnabled, false);
  assert.equal(v.live?.enableSource, 'button');
});

// ---- command lifecycle ----

test('command: pending → acknowledged only for the matching commandId', () => {
  let s = hardwareOpen();
  s = reducer(s, { type: 'TELEMETRY', telemetry: telemetry(), receivedAt: 1000 });
  s = reducer(s, { type: 'COMMAND_PENDING', commandId: 'abc', requested: false, at: 1000 });
  assert.equal(s.command.status, 'pending');
  assert.equal(deriveView(s, 1100).canCommand, false, 'no second command while pending');

  s = reducer(s, {
    type: 'COMMAND_ACK',
    ack: { type: 'commandAck', commandId: 'other', accepted: true, systemEnabled: false, message: '' },
    at: 1100,
  });
  assert.equal(s.command.status, 'pending', 'unrelated ack ignored');

  s = reducer(s, {
    type: 'COMMAND_ACK',
    ack: { type: 'commandAck', commandId: 'abc', accepted: true, systemEnabled: false, message: 'System disabled' },
    at: 1150,
  });
  assert.equal(s.command.status, 'acknowledged');
  assert.equal(s.telemetry?.systemEnabled, false, 'confirmed state applied');
});

test('command: rejected keeps the confirmed state', () => {
  let s = hardwareOpen();
  s = reducer(s, { type: 'TELEMETRY', telemetry: telemetry(), receivedAt: 1000 });
  s = reducer(s, { type: 'COMMAND_PENDING', commandId: 'abc', requested: false, at: 1000 });
  s = reducer(s, {
    type: 'COMMAND_ACK',
    ack: { type: 'commandAck', commandId: 'abc', accepted: false, systemEnabled: true, message: 'Unsupported' },
    at: 1100,
  });
  assert.equal(s.command.status, 'rejected');
  assert.equal(s.telemetry?.systemEnabled, true);
});

test('command: timeout does not assume the requested state', () => {
  let s = hardwareOpen();
  s = reducer(s, { type: 'TELEMETRY', telemetry: telemetry(), receivedAt: 1000 });
  s = reducer(s, { type: 'COMMAND_PENDING', commandId: 'abc', requested: false, at: 1000 });
  s = reducer(s, { type: 'COMMAND_FAILED', status: 'timeout', message: 'timeout', at: 4000 });
  assert.equal(s.command.status, 'timeout');
  assert.equal(s.telemetry?.systemEnabled, true);
  // A late ack after timeout is ignored.
  s = reducer(s, {
    type: 'COMMAND_ACK',
    ack: { type: 'commandAck', commandId: 'abc', accepted: true, systemEnabled: false, message: '' },
    at: 4500,
  });
  assert.equal(s.command.status, 'timeout');
});

test('switching mode discards all data from the previous source', () => {
  let s = initialState('demo', 'ws://test:81', 1500);
  s = reducer(s, { type: 'TELEMETRY', telemetry: telemetry(), receivedAt: 1000 });
  s = reducer(s, { type: 'SET_MODE', mode: 'hardware' });
  assert.equal(s.telemetry, null);
  assert.equal(s.lastDetection, null);
  assert.equal(s.lastUpdateAt, null);
  assert.equal(deriveView(s, 1000).live, null);
});
