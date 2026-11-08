import { describe, expect, it } from 'vitest';
import { envelopeOf, gainAt, gainPoints, playedLength, playedSound } from './sound-mix.ts';

describe('sound envelopes', () => {
  const pieces = [
    { at: 2, from: 1, duration: 3 },
    { at: 5, from: 0, duration: 4 },
  ];

  it('runs from the first piece to the end of the last', () => {
    expect(envelopeOf(pieces, 0.5, 1, 2)).toEqual({ at: 2, length: 7, volume: 0.5, fadeIn: 1, fadeOut: 2 });
    expect(envelopeOf([], 1)).toBeNull();
  });

  it('keeps each fade to half of what plays', () => {
    expect(envelopeOf(pieces, 1, 10, 6)).toMatchObject({ fadeIn: 3.5, fadeOut: 3.5 });
  });

  it('rises over the fade in, holds, and falls to silence over the fade out', () => {
    const e = envelopeOf(pieces, 0.5, 1, 2)!;
    expect(gainAt(e, 1.9)).toBe(0);
    expect(gainAt(e, 2)).toBe(0);
    expect(gainAt(e, 2.5)).toBeCloseTo(0.25);
    expect(gainAt(e, 4)).toBe(0.5);
    expect(gainAt(e, 8)).toBeCloseTo(0.25);
    expect(gainAt(e, 9)).toBe(0);
    expect(gainAt(e, 9.1)).toBe(0);
  });

  it('is the volume all along without fades', () => {
    const e = envelopeOf(pieces, 0.7)!;
    expect([gainAt(e, 2), gainAt(e, 5), gainAt(e, 9)]).toEqual([0.7, 0.7, 0.7]);
  });

  it('gives the corners from a moment on, for ramps', () => {
    const e = envelopeOf(pieces, 1, 1, 2)!;
    expect(gainPoints(e, 0)).toEqual([
      { t: 2, gain: 0 },
      { t: 3, gain: 1 },
      { t: 7, gain: 1 },
      { t: 9, gain: 0 },
    ]);
    // From inside the fade in: where it is now, then on from there.
    expect(gainPoints(e, 2.5).map((p) => p.t)).toEqual([2.5, 3, 7, 9]);
    expect(gainPoints(e, 2.5)[0]!.gain).toBeCloseTo(0.5);
    expect(gainPoints(e, 9)).toEqual([]);
  });

  it('plays a layer until its file runs out, or all along when it loops', () => {
    const layer = { start: 10, end: 15, offset: 1, loop: false };
    expect(playedLength(layer, 3)).toBe(2);
    expect(playedLength(layer, 30)).toBe(5);
    expect(playedLength({ ...layer, loop: true }, 3)).toBe(5);
  });

  it('plays from the first piece, looping when there is more than one', () => {
    expect(playedSound(pieces, 4, 1)).toMatchObject({ from: 1, loop: true, period: 4 });
    expect(playedSound(pieces.slice(0, 1), 4, 1)).toMatchObject({ from: 1, loop: false });
  });
});
