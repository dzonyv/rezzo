import { describe, expect, it } from 'vitest';
import { DEFAULT_MOTION, layerTransformAt, type Motion, type Timed, type Transform } from './motion.ts';

const BASE: Transform = { x: 0.5, y: 0.5, scale: 0.6, rotation: 0, opacity: 1 };

function layer(motion: Partial<Motion> = {}, base: Transform = BASE): Timed {
  const none = { ...DEFAULT_MOTION, in: { ...DEFAULT_MOTION.in, kind: 'none' as const } };
  return { start: 10, end: 13, transform: [{ t: 10, value: base, ease: 'cut' }], motion: { ...none, ...motion } };
}

describe('layer motion', () => {
  it('is the keyframed transform without animations', () => {
    expect(layerTransformAt(layer(), 11)).toEqual(BASE);
  });

  it('follows smooth keyframes', () => {
    const l = layer();
    l.transform = [
      { t: 10, value: BASE, ease: 'smooth' },
      { t: 12, value: { ...BASE, x: 0.9 }, ease: 'cut' },
    ];
    expect(layerTransformAt(l, 11).x).toBeCloseTo(0.7);
    expect(layerTransformAt(l, 12.5).x).toBeCloseTo(0.9);
  });

  it('pops in: small and clear at the start, a little past full size, then settled', () => {
    const l = layer({ in: { kind: 'pop', direction: 'left', seconds: 0.3 } });
    const start = layerTransformAt(l, 10);
    expect(start.scale).toBeCloseTo(0.6 * 0.7);
    expect(start.opacity).toBe(0);
    expect(layerTransformAt(l, 10.2).scale).toBeGreaterThan(0.6);
    expect(layerTransformAt(l, 10.3)).toEqual(BASE);
  });

  it('slides in from the chosen side and out the other way', () => {
    const l = layer({ in: { kind: 'slide', direction: 'left', seconds: 0.5 }, out: { kind: 'slide', direction: 'down', seconds: 0.5 } });
    expect(layerTransformAt(l, 10).x).toBeCloseTo(-0.5);
    expect(layerTransformAt(l, 10.25).x).toBeGreaterThan(-0.5);
    expect(layerTransformAt(l, 10.25).x).toBeLessThan(0.5);
    expect(layerTransformAt(l, 11).x).toBe(0.5);
    expect(layerTransformAt(l, 13).y).toBeCloseTo(1.5);
    expect(layerTransformAt(l, 12.4).y).toBe(0.5);
  });

  it('fades out to nothing at the end', () => {
    const l = layer({ out: { kind: 'fade', direction: 'left', seconds: 1 } });
    expect(layerTransformAt(l, 12).opacity).toBe(1);
    expect(layerTransformAt(l, 12.5).opacity).toBeCloseTo(0.5);
    expect(layerTransformAt(l, 13).opacity).toBe(0);
  });

  it('shares a short layer between coming in and going out', () => {
    const l = layer({ in: { kind: 'fade', direction: 'left', seconds: 3 }, out: { kind: 'fade', direction: 'left', seconds: 3 } });
    // Each gets half of the 3 s: fully in at the middle.
    expect(layerTransformAt(l, 11.5).opacity).toBeCloseTo(1);
    expect(layerTransformAt(l, 10.75).opacity).toBeCloseTo(0.5);
  });

  it('bounces in from above', () => {
    const l = layer({ in: { kind: 'bounce', direction: 'left', seconds: 0.6 } });
    expect(layerTransformAt(l, 10).y).toBeCloseTo(0.25);
    expect(layerTransformAt(l, 10.6).y).toBeCloseTo(0.5);
  });

  it('shakes the same way every time, and not at all at strength 0', () => {
    const l = layer({ loop: { kind: 'shake', direction: 'left', strength: 1 } });
    const a = [11, 11.033, 11.5].map((t) => layerTransformAt(l, t));
    const b = [11, 11.033, 11.5].map((t) => layerTransformAt(l, t));
    expect(a).toEqual(b);
    expect(new Set(a.map((v) => v.x)).size).toBe(3);
    expect(a.every((v) => Math.abs(v.x - 0.5) <= 0.015 && Math.abs(v.rotation) <= 3)).toBe(true);
    const still = layer({ loop: { kind: 'shake', direction: 'left', strength: 0 } });
    expect(layerTransformAt(still, 11.2)).toEqual(BASE);
  });

  it('pulses between full size and a little larger', () => {
    const l = layer({ loop: { kind: 'pulse', direction: 'left', strength: 1 } });
    expect(layerTransformAt(l, 10).scale).toBeCloseTo(0.6);
    expect(layerTransformAt(l, 10.4).scale).toBeCloseTo(0.6 * 1.08);
  });

  it('grows and drifts across the whole layer for Ken Burns', () => {
    const l = layer({ loop: { kind: 'kenBurns', direction: 'right', strength: 1 } });
    const first = layerTransformAt(l, 10);
    const last = layerTransformAt(l, 13);
    expect(first.scale).toBeCloseTo(0.6);
    expect(last.scale).toBeCloseTo(0.6 * 1.25);
    expect(first.x).toBeCloseTo(0.46);
    expect(last.x).toBeCloseTo(0.54);
  });
});
