import { describe, expect, it } from 'vitest';
import { ANALYSIS_VERSION, type ClipAnalysis, type Seat } from './analysis.ts';
import { autoFrame, spliceKeys, withAutoFrame, type AutoFrameOptions } from './autoframe.ts';
import { cropRect, defaultVideoLayer, valueAt } from './framing.ts';
import { frameAt, snapToFrame, type FrameRate } from './frames.ts';
import type { Animated } from './project.ts';
import { stretchesOf, type Stretch, type Target } from './speakers.ts';
import type { VoiceTurn } from './voices.ts';

const RATE: FrameRate = [30, 1];
const WIDTH = 1920;
const HEIGHT = 1080;
const ASPECT = 1080 / 1920;
const SOURCE = { width: WIDTH, height: HEIGHT };
const OPTIONS: AutoFrameOptions = { width: 'medium', change: 'cut' };

/** A seat whose head is at (x, y), or goes wherever `move` says. */
function seat(id: number, shot: number, span: { start: number; end: number }, x: number, size = 100, move: (t: number) => number = () => x): Seat {
  const box = (t: number) => ({ x: move(t) - size / 2, y: 300, w: size, h: size });
  const samples = [];
  for (let t = span.start; t < span.end; t += 0.1) samples.push({ t, box: box(t), mouth: null });
  return { id, shot, box: box(span.start), samples };
}

function analysisOf(shots: { start: number; end: number }[], seats: Seat[]): ClipAnalysis {
  return { version: ANALYSIS_VERSION, start: shots[0]!.start, end: shots.at(-1)!.end, width: WIDTH, height: HEIGHT, shots, seats };
}

const stretch = (start: number, end: number, target: Target): Stretch => ({ start, end, shot: 0, voice: null, pick: null, target });
const on = (id: number): Target => ({ kind: 'seat', seat: id, why: 'pick' });
const range = (a: ClipAnalysis) => ({ start: a.start, end: a.end });

describe('what the picture shows', () => {
  const close = { start: 0, end: 10 };
  const two = { start: 10, end: 20 };
  const empty = { start: 20, end: 30 };
  const analysis = analysisOf([close, two, empty], [seat(0, 0, close, 960), seat(1, 1, two, 480), seat(2, 1, two, 1440)]);

  it('follows the one person, shows both when it can\'t tell, and the whole frame with nobody', () => {
    const framed = autoFrame(analysis, stretchesOf(analysis, [], []), range(analysis), OPTIONS, RATE);
    expect(framed.layout.map((k) => [k.t, k.value])).toEqual([
      [0, 'follow'],
      [10, 'split'],
      [20, 'full'],
    ]);
    expect(framed.layout.every((k) => k.ease === 'cut')).toBe(true);
  });

  it('puts the person on the left on top', () => {
    const framed = autoFrame(analysis, stretchesOf(analysis, [], []), range(analysis), OPTIONS, RATE);
    expect(valueAt(framed.splitTop, 15).x).toBeCloseTo(0.25, 2);
    expect(valueAt(framed.splitBottom, 15).x).toBeCloseTo(0.75, 2);
  });

  it('cuts to the person who starts talking in a shot', () => {
    const framed = autoFrame(analysis, [stretch(10, 15, on(1)), stretch(15, 20, on(2))], { start: 10, end: 20 }, OPTIONS, RATE);
    expect(framed.layout.map((k) => k.value)).toEqual(['follow']);
    expect(valueAt(framed.follow, 12).x).toBeCloseTo(0.25, 2);
    expect(valueAt(framed.follow, 14.8).x).toBeCloseTo(0.25, 2);
    expect(valueAt(framed.follow, 15).x).toBeCloseTo(0.75, 2);
  });

  it('ignores an interjection', () => {
    const framed = autoFrame(analysis, [stretch(10, 14, on(1)), stretch(14, 15, on(2)), stretch(15, 20, on(1))], { start: 10, end: 20 }, OPTIONS, RATE);
    expect(framed.follow).toHaveLength(1);
    expect(framed.follow[0]!.value.x).toBeCloseTo(0.25, 2);
  });

  it('gives a short first turn to whoever comes next', () => {
    const framed = autoFrame(analysis, [stretch(10, 11, on(1)), stretch(11, 20, on(2))], { start: 10, end: 20 }, OPTIONS, RATE);
    expect(framed.follow).toHaveLength(1);
    expect(framed.follow[0]).toMatchObject({ t: 10 });
    expect(framed.follow[0]!.value.x).toBeCloseTo(0.75, 2);
  });

  it('shows both people while the talk goes back and forth fast', () => {
    const quick = [stretch(10, 12, on(1)), stretch(12, 13.5, on(2)), stretch(13.5, 15, on(1)), stretch(15, 16.5, on(2)), stretch(16.5, 20, on(1))];
    const framed = autoFrame(analysis, quick, { start: 10, end: 20 }, OPTIONS, RATE);
    expect(framed.layout.map((k) => [k.t, k.value])).toEqual([
      [10, 'follow'],
      [12, 'split'],
      [16.5, 'follow'],
    ]);
    expect(valueAt(framed.splitTop, 14).x).toBeCloseTo(0.25, 2);
    expect(valueAt(framed.follow, 18).x).toBeCloseTo(0.25, 2);
  });

  it('keeps following when turns take their time', () => {
    const slow = [stretch(10, 13, on(1)), stretch(13, 16, on(2)), stretch(16, 20, on(1))];
    expect(autoFrame(analysis, slow, { start: 10, end: 20 }, OPTIONS, RATE).layout.map((k) => k.value)).toEqual(['follow']);
  });

  it('frames only the range', () => {
    const framed = autoFrame(analysis, stretchesOf(analysis, [], []), { start: 12, end: 18 }, OPTIONS, RATE);
    expect(framed.layout).toEqual([{ t: 12, value: 'split', ease: 'cut' }]);
    expect(framed.follow).toEqual([]);
  });

  it('pans between two people in a shot on request, and holds until it starts', () => {
    const turns = [stretch(10, 15, on(1)), stretch(15, 20, on(2))];
    const framed = autoFrame(analysis, turns, { start: 10, end: 20 }, { ...OPTIONS, change: 'pan' }, RATE);
    expect(framed.follow.at(-2)).toMatchObject({ ease: 'smooth' });
    expect(valueAt(framed.follow, 14.5).x).toBeCloseTo(0.25, 2);
    const middle = valueAt(framed.follow, 15).x;
    expect(middle).toBeGreaterThan(0.3);
    expect(middle).toBeLessThan(0.7);
    expect(valueAt(framed.follow, 15.5).x).toBeCloseTo(0.75, 2);
  });
});

describe('the camera', () => {
  const span = { start: 0, end: 20 };
  const single = (s: Seat) => analysisOf([span], [s]);
  const framedOf = (s: Seat, options = OPTIONS) => {
    const a = single(s);
    return autoFrame(a, stretchesOf(a, [], []), span, options, RATE).follow;
  };

  it('stays still for a head that only moves a little', () => {
    const keys = framedOf(seat(0, 0, span, 960, 100, (t) => 960 + 10 * Math.sin(t * 3)));
    expect(keys).toHaveLength(1);
  });

  it('goes after a head that moves away, smoothly and without lagging behind', () => {
    const lean = (t: number) => 600 + Math.min(1, Math.max(0, (t - 8) / 4)) * 500;
    const keys = framedOf(seat(0, 0, span, 600, 100, lean));
    expect(keys.length).toBeGreaterThan(1);
    expect(keys.length).toBeLessThan(6);
    expect(keys.slice(0, -1).every((k) => k.ease === 'smooth')).toBe(true);
    expect(keys.at(-1)!.ease).toBe('cut');
    // At any moment the head is in the picture.
    for (let t = 0; t < 20; t += 0.25) {
      const r = cropRect(valueAt(keys, t), ASPECT, SOURCE);
      expect(lean(t) / WIDTH).toBeGreaterThan(r.x);
      expect(lean(t) / WIDTH).toBeLessThan(r.x + r.w);
    }
  });

  it('zooms from the size of the head, the same through a scene, within the limits', () => {
    const size = (width: AutoFrameOptions['width']) => framedOf(seat(0, 0, span, 960, 100), { ...OPTIONS, width })[0]!.value.zoom;
    expect(size('tight')).toBeGreaterThan(size('medium'));
    expect(size('medium')).toBeGreaterThan(size('wide'));
    expect(framedOf(seat(0, 0, span, 960, 900))[0]!.value.zoom).toBe(1);
  });

  it("doesn't blow the picture up past what the source can give", () => {
    const value = framedOf(seat(0, 0, span, 960, 10))[0]!.value;
    expect(1080 / (cropRect(value, ASPECT, SOURCE).w * WIDTH)).toBeCloseTo(5, 5);
  });

  it('gives both halves of Split the same zoom', () => {
    const a = analysisOf([span], [seat(0, 0, span, 480, 60), seat(1, 0, span, 1440, 120)]);
    const framed = autoFrame(a, stretchesOf(a, [], []), span, OPTIONS, RATE);
    expect(framed.splitTop[0]!.value.zoom).toBe(framed.splitBottom[0]!.value.zoom);
    expect(framed.splitTop[0]!.value.zoom).toBeGreaterThan(1);
  });

  it('puts the head in the upper part of the picture, inside the frame', () => {
    const value = framedOf(seat(0, 0, span, 960, 100))[0]!.value;
    const r = cropRect(value, ASPECT, SOURCE);
    expect((350 / HEIGHT - r.y) / r.h).toBeCloseTo(0.38, 1);
    const atEdge = framedOf(seat(0, 0, span, 20, 100))[0]!.value;
    expect(cropRect(atEdge, ASPECT, SOURCE).x).toBe(0);
    expect(atEdge.x).toBeCloseTo(cropRect(atEdge, ASPECT, SOURCE).w / 2, 5);
  });

  it('puts every keyframe on a frame, in time order', () => {
    const a = analysisOf([{ start: 0.013, end: 7.3 }, { start: 7.3, end: 20.07 }], [seat(0, 0, { start: 0, end: 7.3 }, 400), seat(1, 1, { start: 7.3, end: 20 }, 1500, 100, (t) => 1500 - t * 30)]);
    const { follow, layout } = autoFrame(a, stretchesOf(a, [], []), range(a), OPTIONS, RATE);
    for (const keys of [follow, layout]) {
      keys.forEach((k, i) => {
        expect(k.t).toBe(snapToFrame(k.t, RATE));
        if (i > 0) expect(frameAt(k.t, RATE)).toBeGreaterThan(frameAt(keys[i - 1]!.t, RATE));
      });
    }
  });

  it('copes with a shot of only a frame or two', () => {
    const shots = [{ start: 0, end: 0.066 }, { start: 0.066, end: 10 }];
    const a = analysisOf(shots, [seat(0, 0, shots[0]!, 400, 100, (t) => 400 + t * 3000), seat(1, 1, shots[1]!, 1500)]);
    const { follow } = autoFrame(a, stretchesOf(a, [], []), range(a), OPTIONS, RATE);
    follow.forEach((k, i) => i > 0 && expect(k.t).toBeGreaterThan(follow[i - 1]!.t));
    expect(valueAt(follow, 5).x).toBeCloseTo(1500 / WIDTH, 2);
  });

  it('gets its targets from who talks', () => {
    const a = analysisOf([span], [seat(0, 0, span, 480), seat(1, 0, span, 1440)]);
    const turns: VoiceTurn[] = [{ start: 1, end: 9, voice: 0 }, { start: 11, end: 19, voice: 1 }];
    const framed = autoFrame(a, stretchesOf(a, turns, [{ t: 2, x: 0.75, y: 350 / HEIGHT, size: 100 / WIDTH }]), span, OPTIONS, RATE);
    expect(framed.layout.map((k) => k.value)).toEqual(['follow']);
    expect(valueAt(framed.follow, 5).x).toBeCloseTo(0.75, 2);
    expect(valueAt(framed.follow, 15).x).toBeCloseTo(0.25, 2);
  });
});

describe('putting it in the clip', () => {
  const keys = (...ts: number[]): Animated<number> => ts.map((t) => ({ t, value: t, ease: 'smooth' }));
  const next = (t: number): Animated<number> => [{ t, value: 100, ease: 'cut' }];

  it('replaces everything up to the end of the clip', () => {
    expect(spliceKeys(keys(0, 5, 10), { start: 0, end: 12 }, next(0), true, RATE)).toEqual(next(0));
  });

  it('leaves what is before the range, which then holds', () => {
    const out = spliceKeys(keys(0, 5, 10), { start: 4, end: 12 }, next(4), true, RATE);
    expect(out).toEqual([{ t: 0, value: 0, ease: 'cut' }, ...next(4)]);
  });

  it('goes on after the range as it did before', () => {
    const out = spliceKeys(keys(0, 10), { start: 2, end: 6 }, next(2), false, RATE);
    expect(out.map((k) => k.t)).toEqual([0, 2, 6, 10]);
    expect(valueAt(out, 6)).toBeCloseTo(valueAt(keys(0, 10), 6), 5);
    expect(out[2]!.ease).toBe('smooth');
  });

  it('leaves a track alone when the range has no use for it', () => {
    const old = keys(0, 5);
    expect(spliceKeys(old, { start: 0, end: 10 }, [], true, RATE)).toBe(old);
  });

  it('drops layout keyframes that repeat', () => {
    const layer = { ...defaultVideoLayer(0), layout: [{ t: 0, value: 'follow' as const, ease: 'cut' as const }] };
    const framed = { layout: [{ t: 4, value: 'follow' as const, ease: 'cut' as const }], follow: [], splitTop: [], splitBottom: [] };
    expect(withAutoFrame(layer, framed, { start: 4, end: 8 }, false, RATE).layout).toHaveLength(1);
  });
});
