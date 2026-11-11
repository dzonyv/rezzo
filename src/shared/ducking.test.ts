import { describe, expect, it } from 'vitest';
import { duckGainAt, duckPoints, duckPointsFrom, duckSignal, parseLevels, speechOf } from './ducking.ts';

/** Levels every 20 ms: `quiet` dB, with `loud` dB over these stretches (seconds). */
function levels(seconds: number, loud: [number, number][], quietDb = -60, loudDb = -20): number[] {
  return Array.from({ length: Math.round(seconds / 0.02) }, (_, i) => (loud.some(([a, b]) => i * 0.02 >= a - 1e-9 && i * 0.02 < b - 1e-9) ? loudDb : quietDb));
}

describe('finding speech', () => {
  it('reads the levels FFmpeg prints, silence as very quiet', () => {
    const stderr = [
      '[Parsed_ametadata_4 @ 0] frame:0    pts:0       pts_time:0',
      '[Parsed_ametadata_4 @ 0] lavfi.astats.Overall.RMS_level=-23.5',
      '[Parsed_ametadata_4 @ 0] frame:1    pts:160     pts_time:0.02',
      '[Parsed_ametadata_4 @ 0] lavfi.astats.Overall.RMS_level=-inf',
    ].join('\n');
    expect(parseLevels(stderr)).toEqual([-23.5, -100]);
  });

  it('finds the loud stretches, in output time', () => {
    expect(speechOf(levels(6, [[1, 2], [4, 5]]))).toEqual([
      { start: expect.closeTo(1, 5), end: expect.closeTo(2, 5) },
      { start: expect.closeTo(4, 5), end: expect.closeTo(5, 5) },
    ]);
  });

  it('joins speech over a short gap, and leaves out a click', () => {
    const spans = speechOf(levels(6, [[1, 2], [2.3, 3], [4.5, 4.54]]))!;
    expect(spans).toHaveLength(1);
    expect(spans[0]!.start).toBeCloseTo(1);
    expect(spans[0]!.end).toBeCloseTo(3);
  });

  it("can't tell speech when everything is about as loud, or there's nothing", () => {
    expect(speechOf(levels(6, [[1, 2]], -25, -20))).toBeNull();
    expect(speechOf([])).toBeNull();
  });
});

describe('turning down under speech', () => {
  const speech = [{ start: 1, end: 2 }];

  it('goes down just before speech and back up after it', () => {
    const points = duckPoints(speech, 12);
    expect(points.map((p) => p.t)).toEqual([0.85, 1, 2, 2.4]);
    expect(duckGainAt(points, 0.5)).toBe(1);
    expect(duckGainAt(points, 1.5)).toBeCloseTo(0.2512, 4);
    expect(duckGainAt(points, 2.2)).toBeCloseTo(0.2512 + (1 - 0.2512) / 2, 3);
    expect(duckGainAt(points, 3)).toBe(1);
  });

  it('stays down between stretches whose slopes would meet', () => {
    expect(duckPoints([{ start: 1, end: 2 }, { start: 2.5, end: 3 }], 12).map((p) => p.t)).toEqual([0.85, 1, 3, 3.4]);
    expect(duckPoints([{ start: 1, end: 2 }, { start: 3, end: 4 }], 12)).toHaveLength(8);
  });

  it('turns nothing down without speech', () => {
    expect(duckPoints([], 12)).toEqual([]);
    expect(duckGainAt([], 1)).toBe(1);
    expect(duckPointsFrom([], 1)).toEqual([]);
  });

  it('gives the corners from a moment on, starting with the gain there', () => {
    const points = duckPoints(speech, 12);
    const from = duckPointsFrom(points, 2.2);
    expect(from[0]).toEqual({ t: 2.2, gain: duckGainAt(points, 2.2) });
    expect(from.slice(1)).toEqual([points[3]]);
  });

  it('samples the same gain for the export as the preview ramps through', () => {
    const points = duckPoints([{ start: 1, end: 2 }, { start: 3, end: 3.5 }], 18);
    const signal = duckSignal(points, 0.5, 3.5, 1000);
    expect(signal).toHaveLength(3500);
    for (const i of [0, 300, 420, 700, 1700, 2100, 2600, 3400]) expect(signal[i]).toBeCloseTo(duckGainAt(points, 0.5 + i / 1000), 5);
  });
});
