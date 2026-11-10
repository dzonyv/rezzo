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

/** Starts at twice the average speed and slows to a stop: gentler on the first frames than easeOutCubic. */
export const easeOutQuad = (f: number): number => 1 - (1 - f) ** 2;

export const easeInQuad = (f: number): number => f * f;

/** How much speed a bounce keeps when it lands. */
const BOUNCE_KEEP = 0.5;
/** The fall, then two bounces, in units of the fall's time. */
const BOUNCE_ARCS = [1, 2 * BOUNCE_KEEP, 2 * BOUNCE_KEEP ** 2];
const BOUNCE_TIME = BOUNCE_ARCS.reduce((a, b) => a + b, 0);

/**
 * Falls under steady gravity, lands and bounces twice, each bounce a quarter
 * as high as the one before. Only two bounces, so each one lasts a few
 * frames even at 25 fps.
 */
export function easeOutBounce(f: number): number {
  let u = clamp01(f) * BOUNCE_TIME;
  if (u < 1) return u * u;
  u -= 1;
  for (let i = 1; i < BOUNCE_ARCS.length; i++) {
    const arc = BOUNCE_ARCS[i]!;
    if (u < arc) {
      const half = arc / 2;
      return 1 - (half * half - (u - half) ** 2);
    }
    u -= arc;
  }
  return 1;
}

/** A repeatable pseudo-random value in -1..1 for an integer. */
export function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/** Smooth noise in -1..1 along `x`; `seed` gives independent curves. */
export function noise(x: number, seed: number): number {
  const i = Math.floor(x);
  const a = hash(i + seed * 7919);
  const b = hash(i + 1 + seed * 7919);
  return a + (b - a) * smoothstep(x - i);
}
