import { describe, expect, it } from 'vitest';
import { overlayLayout, overlayRange, overlaySize, overlaySoundPieces, stackedHalf, videoLayersOverLimit } from './overlay-files.ts';

describe('video layer files', () => {
  it('shrinks a file to fit the output frame, never enlarging it', () => {
    expect(overlaySize({ width: 1920, height: 1080 })).toEqual({ width: 1080, height: 608 });
    expect(overlaySize({ width: 1080, height: 1920 })).toEqual({ width: 1080, height: 1920 });
    expect(overlaySize({ width: 2160, height: 3840 })).toEqual({ width: 1080, height: 1920 });
    expect(overlaySize({ width: 640, height: 360 })).toEqual({ width: 640, height: 360 });
    expect(overlaySize({ width: 2000, height: 2000 })).toEqual({ width: 1080, height: 1080 });
    // Odd sizes come out even, as 4:2:0 needs.
    expect(overlaySize({ width: 641, height: 359 })).toEqual({ width: 642, height: 360 });
  });

  it('starts the alpha half on a macroblock row, at least two rows below the colour', () => {
    expect(stackedHalf(1080)).toBe(1088);
    expect(stackedHalf(1920)).toBe(1936);
    // 720 is already a multiple of 16; the gap still needs a row of macroblocks.
    expect(stackedHalf(720)).toBe(736);
    expect(stackedHalf(1086)).toBe(1088);
    expect(stackedHalf(1087)).toBe(1104);
  });

  it('lays out files with and without alpha', () => {
    expect(overlayLayout({ width: 1920, height: 1080, alpha: false })).toEqual({ width: 1080, height: 608, codedHeight: 608, alphaAt: null });
    expect(overlayLayout({ width: 1080, height: 1920, alpha: true })).toEqual({ width: 1080, height: 1920, codedHeight: 3872, alphaAt: 1936 });
  });

  it('converts a short file whole and a long one only where the layer plays', () => {
    const layer = { start: 10, end: 14, offset: 3, loop: false };
    expect(overlayRange(layer, { duration: 30 })).toEqual({ start: 0, end: 30 });
    expect(overlayRange(layer, { duration: 600 })).toEqual({ start: 3, end: 7 });
    expect(overlayRange({ ...layer, offset: 598 }, { duration: 600 })).toEqual({ start: 598, end: 600 });
    // Looping past the end of a long file needs all of it.
    expect(overlayRange({ ...layer, offset: 598, loop: true }, { duration: 600 })).toEqual({ start: 0, end: 600 });
    expect(overlayRange({ ...layer, loop: true }, { duration: 600 })).toEqual({ start: 3, end: 7 });
  });
});

describe('video layer sound', () => {
  const clip = { start: 10, end: 20 };

  it('plays once from the offset, stopping at the end of the file', () => {
    expect(overlaySoundPieces({ start: 12, end: 18, offset: 1, loop: false }, 3, clip)).toEqual([{ at: 12, from: 1, duration: 2 }]);
    expect(overlaySoundPieces({ start: 12, end: 18, offset: 5, loop: false }, 3, clip)).toEqual([]);
  });

  it('starts over at the end of the file when it loops', () => {
    const pieces = overlaySoundPieces({ start: 12, end: 18, offset: 1, loop: true }, 2.5, clip);
    expect(pieces.map((p) => [p.at, p.from, p.duration].map((v) => +v.toFixed(6)))).toEqual([
      [12, 1, 1.5],
      [13.5, 0, 2.5],
      [16, 0, 2],
    ]);
  });

  it('keeps to the clip', () => {
    // The layer starts before the clip: its sound is already 3 s in at the clip's start.
    expect(overlaySoundPieces({ start: 7, end: 25, offset: 0, loop: false }, 60, clip)).toEqual([{ at: 10, from: 3, duration: 10 }]);
  });
});

describe('the limit on video layers', () => {
  const video = (start: number, end: number) => ({ id: `v${start}-${end}`, kind: 'overlay' as const, start, end });
  const clip = (...layers: ReturnType<typeof video>[]) => ({ layers }) as unknown as Parameters<typeof videoLayersOverLimit>[0];

  it('leaves out the fifth layer only where five show at once', () => {
    const four = [video(0, 10), video(0, 10), video(2, 6), video(0, 4)].map((v, i) => ({ ...v, id: `${v.id}#${i}` }));
    expect(videoLayersOverLimit(clip(...four, video(5, 8)))).toEqual(new Set());
    expect(videoLayersOverLimit(clip(...four, video(3, 8)))).toEqual(new Set(['v3-8']));
    // The topmost one goes, whichever started first.
    expect(videoLayersOverLimit(clip(video(3, 8), ...four))).toEqual(new Set(['v0-4#3']));
  });
});
