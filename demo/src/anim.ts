import { Easing, interpolate, spring } from 'remotion';
import { FPS } from './theme';

/** 0 → 1 between two frames, eased; clamped outside them. */
export function ease(frame: number, from: number, to: number, easing = Easing.bezier(0.33, 0, 0.2, 1)): number {
  return interpolate(frame, [from, to], [0, 1], { easing, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
}

/** A short springy entrance starting at `at`: 0 before it, settling at 1. */
export function pop(frame: number, at: number, damping = 14): number {
  return spring({ frame: frame - at, fps: FPS, config: { damping, stiffness: 180, mass: 0.7 } });
}

/** Piecewise-linear value over keyframes [time, value], smoothed at each key. */
export function track(t: number, keys: [number, number][]): number {
  return interpolate(
    t,
    keys.map(([k]) => k),
    keys.map(([, v]) => v),
    { easing: Easing.inOut(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
}
