import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DetectionPipeline,
  calibrate,
  estimateDirection,
} from '../src/lib/directionAlgorithm.ts';
import { DemoSimulator } from '../src/services/demoSimulator.ts';
import type { MicQuad } from '../src/types/protocol.ts';

const floors: MicQuad = [100, 100, 100, 100];
const thresholds: MicQuad = [200, 200, 200, 200];

test('calibration: median floor + max(100, 35 %), at least 180', () => {
  assert.deepEqual(calibrate(Array(150).fill(50)), { noiseFloor: 50, threshold: 180 });
  assert.deepEqual(calibrate(Array(150).fill(100)), { noiseFloor: 100, threshold: 200 });
  assert.deepEqual(calibrate(Array(150).fill(400)), { noiseFloor: 400, threshold: 540 });
});

test('no mic above threshold → no estimate', () => {
  assert.equal(estimateDirection([150, 190, 200, 120], thresholds, floors), null);
});

test('single qualifying mic → its nominal angle', () => {
  assert.deepEqual(estimateDirection([150, 500, 150, 150], thresholds, floors), { angle: 60, strongest: 1 });
});

test('interpolates toward the stronger qualifying neighbour', () => {
  // Mic 2 strength 400, Mic 3 strength 200 → 60 + 200/600 × 60 = 80°
  const e = estimateDirection([150, 500, 300, 150], thresholds, floors)!;
  assert.equal(e.strongest, 1);
  assert.ok(Math.abs(e.angle - 80) < 1e-9);
});

test('end microphones interpolate inward only', () => {
  const e = estimateDirection([500, 300, 150, 150], thresholds, floors)!;
  assert.ok(Math.abs(e.angle - 20) < 1e-9); // 0 + 200/600 × 60
});

test('pipeline: needs 2 consecutive detections, smooths, servo = 180 − angle within 10–170', () => {
  const p = new DetectionPipeline();
  p.process({ angle: 72, strongest: 1 });
  assert.equal(p.servoAngle, 90, 'first detection only confirms');
  p.process({ angle: 72, strongest: 1 });
  assert.equal(p.smoothedAngle, 72);
  assert.equal(p.servoAngle, 108);

  p.process(null); // silence resets confirmation
  p.process({ angle: 0, strongest: 0 });
  assert.equal(p.servoAngle, 108);
  p.process({ angle: 0, strongest: 0 });
  // 0.35 × 0 + 0.65 × 72 = 46.8 → target 180 − 47 = 133
  assert.ok(Math.abs(p.smoothedAngle - 46.8) < 1e-9);
  assert.equal(p.servoAngle, 133);
});

test('pipeline: servo target is clamped and small changes are held', () => {
  const p = new DetectionPipeline();
  p.process({ angle: 180, strongest: 3 });
  p.process({ angle: 180, strongest: 3 });
  assert.equal(p.servoAngle, 10);
  p.process({ angle: 177, strongest: 3 });
  p.process({ angle: 177, strongest: 3 });
  assert.equal(p.servoAngle, 10);
});

test('demo simulator: calibrates, detects, and respects disable', () => {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const sim = new DemoSimulator(1000, rand);
  sim.start(0);

  let t = sim.snapshot(0);
  assert.equal(t.calibrating, true);
  assert.equal(t.micActivity, null);
  assert.equal(t.led1On, true);
  assert.equal(t.led2On, false);

  let detections = 0;
  for (let now = 0; now <= 30000; now += 200) {
    sim.advance(now);
    t = sim.snapshot(now);
    if (t.soundDetected) {
      detections++;
      assert.ok(t.estimatedAngle !== null && t.estimatedAngle >= 0 && t.estimatedAngle <= 180);
      assert.ok(t.strongestMic !== null);
      assert.equal(t.led2On, true);
    } else {
      assert.equal(t.estimatedAngle, null);
    }
  }
  assert.ok(detections > 10, 'demo produces sound detections');

  const ack = sim.handleCommand({ type: 'setSystemEnabled', commandId: 'x', enabled: false }, 30000);
  assert.equal(ack.accepted, true);
  assert.equal(ack.systemEnabled, false);
  const servoBefore = sim.snapshot(30000).servoTarget;
  for (let now = 30000; now <= 40000; now += 200) sim.advance(now);
  t = sim.snapshot(40000);
  assert.equal(t.systemEnabled, false);
  assert.equal(t.enableSource, 'web');
  assert.equal(t.soundDetected, false);
  assert.equal(t.micActivity, null);
  assert.equal(t.led1On, false);
  assert.equal(t.led2On, false);
  assert.equal(t.servoTarget, servoBefore, 'no servo movement while disabled');
});
