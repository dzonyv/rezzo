import { describe, expect, it } from 'vitest';
import { clipSoundPieces } from './overlay-files.ts';
import { DEFAULT_PAUSE_OPTIONS, keptLength, keptPieces, layerClock, nextKept, outputTime, pausesOf, withoutSkipAt, withSkips, wordsSpan, type ClipSpan, type Loudness } from './skips.ts';
import type { FrameRate } from './frames.ts';

const RATE: FrameRate = [30, 1];
const clip = (skips: ClipSpan['skips'] = []): ClipSpan => ({ start: 10, end: 20, skips });

describe('kept pieces', () => {
  it('is the whole clip without skips', () => {
    expect(keptPieces(clip())).toEqual([{ start: 10, end: 20 }]);
    expect(keptLength(clip())).toBe(10);
  });

  it('leaves the skips out', () => {
    const c = clip([{ start: 12, end: 13 }, { start: 15, end: 17 }]);
    expect(keptPieces(c)).toEqual([{ start: 10, end: 12 }, { start: 13, end: 15 }, { start: 17, end: 20 }]);
    expect(keptLength(c)).toBe(7);
  });

  it('ignores skips outside a trimmed clip, and cuts those across its ends', () => {
    expect(keptPieces(clip([{ start: 5, end: 6 }, { start: 21, end: 22 }]))).toEqual([{ start: 10, end: 20 }]);
    expect(keptPieces(clip([{ start: 9, end: 11 }, { start: 19, end: 21 }]))).toEqual([{ start: 11, end: 19 }]);
  });

  it('plays a clip trimmed down to nothing but a skip whole', () => {
    expect(keptPieces(clip([{ start: 9, end: 21 }]))).toEqual([{ start: 10, end: 20 }]);
  });
});

describe('output time', () => {
  const c = clip([{ start: 12, end: 13 }]);

  it('leaves skipped time out', () => {
    expect(outputTime(c, 10)).toBe(0);
    expect(outputTime(c, 11)).toBe(1);
    expect(outputTime(c, 14)).toBe(3);
    expect(outputTime(c, 20)).toBe(9);
  });

  it('stands still inside a skip', () => {
    expect(outputTime(c, 12.5)).toBe(2);
  });

  it('runs on outside the clip', () => {
    expect(outputTime(c, 8)).toBe(-2);
    expect(outputTime(c, 22)).toBe(11);
  });

  it('finds the next moment that plays', () => {
    expect(nextKept(c, 11)).toBe(11);
    expect(nextKept(c, 12.5)).toBe(13);
    expect(nextKept(clip([{ start: 19, end: 20 }]), 19.5)).toBeNull();
  });
});

describe('a layer playing through skips', () => {
  const c = clip([{ start: 12, end: 13 }]);

  it('takes off the time skipped since the layer started', () => {
    expect(layerClock(c, 10, 11)).toBe(11);
    expect(layerClock(c, 10, 14)).toBe(13);
    expect(layerClock(c, 13, 14)).toBe(14);
  });

  it('holds inside a skip, and counts only the part after a layer that starts in one', () => {
    expect(layerClock(c, 10, 12.5)).toBe(12);
    expect(layerClock(c, 12.5, 14)).toBe(13.5);
  });

  it('agrees with its sound when a skip lies outside the clip', () => {
    const c = clip([{ start: 6, end: 7 }]);
    const [piece] = clipSoundPieces(c, { start: 5, end: 12, offset: 0, loop: false }, 10);
    expect(layerClock(c, 5, 10) - 5).toBe(piece!.from);
  });

  it('runs on through skips in a clip that plays whole', () => {
    expect(layerClock(clip([{ start: 9, end: 21 }]), 11, 14)).toBe(14);
  });

  it('places its sound in output time, on through the skip', () => {
    const pieces = clipSoundPieces(clip([{ start: 12, end: 13 }]), { start: 11, end: 15, offset: 0, loop: false }, 10);
    expect(pieces).toEqual([{ at: 1, from: 0, duration: 3 }]);
  });

  it('starts a layer from before the clip further into its file', () => {
    const pieces = clipSoundPieces(clip(), { start: 8, end: 12, offset: 0, loop: false }, 10);
    expect(pieces).toEqual([{ at: 0, from: 2, duration: 2 }]);
  });
});

describe('adding and taking back skips', () => {
  it('snaps to frames, keeps order and joins what touches', () => {
    const skips = withSkips(clip([{ start: 15, end: 16 }]), [{ start: 12.01, end: 13.01 }, { start: 15.5, end: 17 }], RATE);
    expect(skips).toEqual([{ start: 12, end: 13 }, { start: 15, end: 17 }]);
  });

  it('leaves no blip between two skips or next to the ends', () => {
    expect(withSkips(clip(), [{ start: 12, end: 13 }, { start: 13.05, end: 14 }], RATE).length).toBe(1);
    expect(withSkips(clip(), [{ start: 10.05, end: 11 }], RATE)).toEqual([{ start: 10, end: 11 }]);
    expect(withSkips(clip(), [{ start: 19, end: 19.95 }], RATE)).toEqual([{ start: 19, end: 20 }]);
  });

  it('looks past a skip outside the clip for a blip at its start', () => {
    const skips = withSkips(clip([{ start: 5, end: 6 }]), [{ start: 10.05, end: 11 }], RATE);
    expect(skips).toEqual([{ start: 5, end: 6 }, { start: 10, end: 11 }]);
  });

  it("won't cut the whole clip", () => {
    const skips = [{ start: 12, end: 13 }];
    expect(withSkips(clip(skips), [{ start: 10, end: 20 }], RATE)).toEqual(skips);
  });

  it('takes back the skip at a moment', () => {
    const c = clip([{ start: 12, end: 13 }, { start: 15, end: 16 }]);
    expect(withoutSkipAt(c, 12.5)).toEqual([{ start: 15, end: 16 }]);
  });

  it('covers cut words on whole frames', () => {
    expect(wordsSpan([{ start: 12.01, end: 12.3 }, { start: 12.4, end: 12.81 }], RATE)).toEqual({ start: 12, end: 12 + 25 / 30 });
    expect(wordsSpan([], RATE)).toBeNull();
  });
});

describe('finding pauses', () => {
  const STEP = 0.02;
  /** Speech at -20 dB with quiet stretches at -60 dB. */
  const sound = (quiet: [number, number][], base = -20, low = -60): Loudness => {
    const db = new Float32Array(10 / STEP).fill(base);
    for (const [from, to] of quiet) db.fill(low, Math.round((from - 10) / STEP), Math.round((to - 10) / STEP));
    return { db, step: STEP, start: 10 };
  };

  it('finds quiet stretches and leaves air around them', () => {
    const pauses = pausesOf(clip(), [], sound([[12, 13], [15, 15.2]]), DEFAULT_PAUSE_OPTIONS);
    expect(pauses).toHaveLength(1);
    expect(pauses[0]!.start).toBeCloseTo(12.1);
    expect(pauses[0]!.end).toBeCloseTo(12.9);
  });

  it('is a matter of each clip\'s own levels', () => {
    expect(pausesOf(clip(), [], sound([[12, 13]], -30, -50), DEFAULT_PAUSE_OPTIONS)).toHaveLength(1);
  });

  it('finds nothing when the sound hardly changes', () => {
    expect(pausesOf(clip(), [], sound([[12, 13]], -20, -25), DEFAULT_PAUSE_OPTIONS)).toEqual([]);
  });

  it('never cuts a word, even a quiet one', () => {
    const pauses = pausesOf(clip(), [{ start: 12.8, end: 13.2 }], sound([[12, 14]]), DEFAULT_PAUSE_OPTIONS);
    expect(pauses).toHaveLength(2);
    expect(pauses[0]!.end).toBeCloseTo(12.7);
    expect(pauses[1]!.start).toBeCloseTo(13.3);
  });

  it('bridges a very short noise inside a pause', () => {
    const s = sound([[12, 12.5], [12.54, 13]]);
    expect(pausesOf(clip(), [], s, DEFAULT_PAUSE_OPTIONS)).toHaveLength(1);
  });

  it('bridges a short noise in a pause that runs to the end of the clip', () => {
    const s = sound([[19.3, 19.6], [19.64, 20]]);
    expect(pausesOf(clip(), [], s, DEFAULT_PAUSE_OPTIONS)).toHaveLength(1);
  });

  it('skips over a pause that is already cut', () => {
    expect(pausesOf(clip([{ start: 12.1, end: 12.9 }]), [], sound([[12, 13]]), DEFAULT_PAUSE_OPTIONS)).toEqual([]);
  });
});
