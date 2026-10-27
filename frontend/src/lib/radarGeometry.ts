// Single coordinate transform for the semicircular radar.
// Physical angle convention: 0° = far right, 90° = top centre, 180° = far left
// (counter-clockwise, like a maths protractor). SVG's y axis points down, so
// y = cy − r·sin(θ).

export const RADAR = {
  width: 1000,
  height: 560,
  cx: 500,
  cy: 500,
  r: 410,
} as const;

export interface Point {
  x: number;
  y: number;
}

export const clampAngle = (deg: number): number => Math.min(180, Math.max(0, deg));

export function polar(angleDeg: number, radius: number = RADAR.r): Point {
  const t = (angleDeg * Math.PI) / 180;
  return {
    x: RADAR.cx + radius * Math.cos(t),
    y: RADAR.cy - radius * Math.sin(t),
  };
}

/** Upper semicircle from 0° (right) through 90° (top) to 180° (left). */
export function semicirclePath(radius: number): string {
  const a = polar(0, radius);
  const b = polar(180, radius);
  // sweep-flag 0 = counter-clockwise on screen, i.e. upwards from the right end.
  return `M ${a.x} ${a.y} A ${radius} ${radius} 0 0 0 ${b.x} ${b.y}`;
}

/** Closed wedge from the centre spanning angle ± halfWidth, clamped to 0–180°. */
export function wedgePath(angleDeg: number, halfWidthDeg: number, radius: number = RADAR.r): string {
  const start = clampAngle(angleDeg - halfWidthDeg);
  const end = clampAngle(angleDeg + halfWidthDeg);
  const p1 = polar(start, radius);
  const p2 = polar(end, radius);
  return `M ${RADAR.cx} ${RADAR.cy} L ${p1.x} ${p1.y} A ${radius} ${radius} 0 0 0 ${p2.x} ${p2.y} Z`;
}

export function directionLabel(angleDeg: number): string {
  if (angleDeg < 15) return 'Right';
  if (angleDeg < 75) return 'Front-right';
  if (angleDeg <= 105) return 'Front';
  if (angleDeg <= 165) return 'Front-left';
  return 'Left';
}
