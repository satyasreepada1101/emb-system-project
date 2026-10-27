import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RADAR, polar, wedgePath, directionLabel } from '../src/lib/radarGeometry.ts';
import { MICS, relativeLevel } from '../src/lib/micLevels.ts';

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('0° renders at the far right endpoint', () => {
  const p = polar(0);
  close(p.x, RADAR.cx + RADAR.r);
  close(p.y, RADAR.cy);
});

test('90° renders at the top centre', () => {
  const p = polar(90);
  close(p.x, RADAR.cx);
  close(p.y, RADAR.cy - RADAR.r);
});

test('180° renders at the far left endpoint', () => {
  const p = polar(180);
  close(p.x, RADAR.cx - RADAR.r);
  close(p.y, RADAR.cy);
});

test('72° points up and to the right of centre (between 60° and 90°)', () => {
  const p = polar(72);
  const p60 = polar(60);
  const p90 = polar(90);
  assert.ok(p.x > RADAR.cx, 'right of centre');
  assert.ok(p.y < RADAR.cy, 'above baseline');
  assert.ok(p.x < p60.x && p.x > p90.x, 'between 60° and 90° horizontally');
  close(p.x, RADAR.cx + RADAR.r * Math.cos((72 * Math.PI) / 180));
  close(p.y, RADAR.cy - RADAR.r * Math.sin((72 * Math.PI) / 180));
});

test('all radar points stay inside the viewBox', () => {
  for (let a = 0; a <= 180; a += 1) {
    const p = polar(a, RADAR.r + 40);
    assert.ok(p.x >= 0 && p.x <= RADAR.width && p.y >= 0 && p.y <= RADAR.height, `angle ${a}`);
  }
});

test('beam wedge is clamped to 0–180°', () => {
  const path = wedgePath(2, 5);
  const firstArc = path.split(' L ')[1].split(' A ')[0].split(' ').map(Number);
  close(firstArc[1], RADAR.cy); // starts at 0°, never below the baseline
});

test('microphone order and nominal angles', () => {
  assert.deepEqual(
    MICS.map((m) => [m.id, m.angle]),
    [
      [1, 0],
      [2, 60],
      [3, 120],
      [4, 180],
    ],
  );
});

test('relative level: noise floor 0 %, threshold 50 %, clamps at 100 %', () => {
  assert.equal(relativeLevel(100, 100, 200), 0);
  assert.equal(relativeLevel(200, 100, 200), 50);
  assert.equal(relativeLevel(300, 100, 200), 100);
  assert.equal(relativeLevel(5000, 100, 200), 100);
  assert.equal(relativeLevel(10, 100, 200), 0);
});

test('direction labels', () => {
  assert.equal(directionLabel(0), 'Right');
  assert.equal(directionLabel(90), 'Front');
  assert.equal(directionLabel(72), 'Front-right');
  assert.equal(directionLabel(180), 'Left');
});
