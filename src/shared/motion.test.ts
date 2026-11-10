import { describe, expect, it } from 'vitest';
import { DEFAULT_MOTION, layerTransformAt, MOTION_SECONDS, secondsForKind, type Motion, type Timed, type Transform } from './motion.ts';

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

  it('bounces in from above, twice, each bounce a few frames long at 25 fps', () => {
    const l = layer({ in: { kind: 'bounce', direction: 'left', seconds: MOTION_SECONDS.bounce } });
    expect(layerTransformAt(l, 10).y).toBeCloseTo(0.25);
    expect(layerTransformAt(l, 10 + MOTION_SECONDS.bounce).y).toBeCloseTo(0.5);
    const ys = Array.from({ length: 21 }, (_, i) => layerTransformAt(l, 10 + i / 25).y);
    // Each bounce turns falling (y growing) into rising (y shrinking) once.
    const ways = ys.slice(1).map((y, i) => Math.sign(y - ys[i]!)).filter((w) => w !== 0);
    expect(ways.filter((w, i) => w < 0 && ways[i - 1]! > 0)).toHaveLength(2);
    expect(ys.every((y) => y <= 0.5 + 1e-9)).toBe(true);
  });

  it('moves no more than a sixth of the way in one 25 fps frame, at the default lengths', () => {
    for (const kind of ['slide', 'zoom', 'pop', 'bounce'] as const) {
      const l = layer({ in: { kind, direction: 'left', seconds: MOTION_SECONDS[kind] } });
      const at = (i: number) => layerTransformAt(l, 10 + i / 25);
      for (let i = 1; i <= 25; i++) {
        expect(Math.abs(at(i).x - at(i - 1).x)).toBeLessThanOrEqual(1 / 6);
        expect(Math.abs(at(i).y - at(i - 1).y)).toBeLessThanOrEqual(1 / 6);
        expect(Math.abs(at(i).scale - at(i - 1).scale) / BASE.scale).toBeLessThanOrEqual(1 / 6);
      }
    }
  });

  it('moves no more than a sixth of the way in one 25 fps frame going out, at the default lengths', () => {
    for (const kind of ['slide', 'zoom', 'pop'] as const) {
      const l = layer({ out: { kind, direction: 'right', seconds: MOTION_SECONDS[kind] } });
      const at = (i: number) => layerTransformAt(l, 13 - i / 25);
      for (let i = 1; i <= 25; i++) {
        expect(Math.abs(at(i).x - at(i - 1).x)).toBeLessThanOrEqual(1 / 6);
        expect(Math.abs(at(i).scale - at(i - 1).scale) / BASE.scale).toBeLessThanOrEqual(1 / 6);
      }
    }
  });

  it('zooms out to a third of the size and slides out the whole way', () => {
    const zoom = layer({ out: { kind: 'zoom', direction: 'left', seconds: 0.45 } });
    expect(layerTransformAt(zoom, 12.55).scale).toBeCloseTo(0.6);
    expect(layerTransformAt(zoom, 13).scale).toBeCloseTo(0.6 * 0.3);
    expect(layerTransformAt(zoom, 13).opacity).toBe(0);
    const slide = layer({ out: { kind: 'slide', direction: 'right', seconds: 0.5 } });
    expect(layerTransformAt(slide, 13).x).toBeCloseTo(1.5);
  });

  it('gives a short layer to coming in and going out by their lengths, and none to a part that is off', () => {
    const both = { ...layer({ in: { kind: 'bounce', direction: 'left', seconds: 0.8 }, out: { kind: 'fade', direction: 'left', seconds: 0.2 } }), end: 10.5 };
    // 1 s wanted, 0.5 s there: the bounce gets 0.4 s and the fade 0.1 s.
    expect(layerTransformAt(both, 10.4).y).toBeCloseTo(0.5);
    expect(layerTransformAt(both, 10.45).opacity).toBeCloseTo(0.5);
    const alone = { ...layer({ in: { kind: 'bounce', direction: 'left', seconds: 0.8 } }), end: 11 };
    expect(layerTransformAt(alone, 10.4).y).toBeLessThan(0.5);
    expect(layerTransformAt(alone, 10.8).y).toBeCloseTo(0.5);
  });

  it('takes the length of the new kind unless the old one was set by hand', () => {
    expect(secondsForKind({ kind: 'pop', seconds: MOTION_SECONDS.pop }, 'slide')).toBe(MOTION_SECONDS.slide);
    expect(secondsForKind({ kind: 'slide', seconds: 0.3 }, 'bounce')).toBe(MOTION_SECONDS.bounce);
    expect(secondsForKind({ kind: 'slide', seconds: 1.2 }, 'zoom')).toBe(1.2);
  });

  it('zooms from a third of the size, not from nothing', () => {
    const l = layer({ in: { kind: 'zoom', direction: 'left', seconds: 0.45 } });
    expect(layerTransformAt(l, 10).scale).toBeCloseTo(0.6 * 0.3);
    expect(layerTransformAt(l, 10.45).scale).toBeCloseTo(0.6);
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
