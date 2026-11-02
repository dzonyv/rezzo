/** Easing curves shared by caption and layer animations: f runs 0..1. */

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export const smoothstep = (f: number): number => f * f * (3 - 2 * f);

export const easeOutCubic = (f: number): number => 1 - (1 - f) ** 3;

export const easeInCubic = (f: number): number => f ** 3;

/** Overshoots a little and settles, for a pop. */
export function easeOutBack(f: number): number {
  const c = 1.7;
  return 1 + (c + 1) * (f - 1) ** 3 + c * (f - 1) ** 2;
}

/** Lands and bounces twice, smaller each time. */
export function easeOutBounce(f: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (f < 1 / d) return n * f * f;
  if (f < 2 / d) return n * (f - 1.5 / d) ** 2 + 0.75;
  if (f < 2.5 / d) return n * (f - 2.25 / d) ** 2 + 0.9375;
  return n * (f - 2.625 / d) ** 2 + 0.984375;
}
