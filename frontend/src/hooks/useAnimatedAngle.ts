import { useEffect, useRef, useState } from 'react';

const DURATION_MS = 450;

/**
 * Eases the radar from its current position to `target` (degrees).
 * Purely visual: it always settles exactly on `target`, the same value the
 * numeric readouts show. Returns null whenever `target` is null.
 */
export function useAnimatedAngle(target: number | null): number | null {
  const [value, setValue] = useState<number | null>(target);
  const currentRef = useRef<number | null>(target);

  useEffect(() => {
    if (target === null) return;
    const from = currentRef.current ?? target;
    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion || from === target) {
      currentRef.current = target;
      setValue(target);
      return;
    }

    const start = performance.now();
    let frame = 0;
    const step = (time: number) => {
      // rAF timestamps can precede `start`; clamp so the beam never overshoots 0–180°.
      const k = Math.min(1, Math.max(0, (time - start) / DURATION_MS));
      const eased = 1 - (1 - k) ** 3;
      const v = Math.min(180, Math.max(0, from + (target - from) * eased));
      currentRef.current = v;
      setValue(v);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return target === null ? null : value;
}
