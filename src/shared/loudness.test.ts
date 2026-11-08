import { describe, expect, it } from 'vitest';
import { dbToGain, evenGain, evenGainDb, LIMITER, LIMITER_HEADROOM_DB, MAX_BOOST_DB, parseEbur128, PEAK_CEILING_DB, TARGET_LUFS } from './loudness.ts';

/** The end of what FFmpeg 9's ebur128 writes, as it writes it. */
const summary = (i: string, peak: string) => `[Parsed_ebur128_0 @ 000002717bc7a980] Summary:

  Integrated loudness:
    I:         ${i} LUFS
    Threshold: -37.1 LUFS

  Loudness range:
    LRA:         0.0 LU
    Threshold: -47.1 LUFS
    LRA low:   -27.1 LUFS
    LRA high:  -27.1 LUFS

  True peak:
    Peak:      ${peak} dBFS
[out#0/null @ 0000027101c794c0] video:0KiB audio:431KiB subtitle:0KiB other streams:0KiB global headers:0KiB muxing overhead: unknown
`;

describe('evening out loudness', () => {
  it('reads the loudness and true peak from the summary', () => {
    expect(parseEbur128(summary('-27.1', '-24.1'))).toEqual({ lufs: -27.1, peak: -24.1 });
  });

  it('reads silence, and a sound shorter than one block, as not measurable', () => {
    expect(parseEbur128(summary('-70.0', '-inf'))).toEqual({ lufs: null, peak: null });
    expect(parseEbur128(summary('-70.0', '-18.1'))).toEqual({ lufs: null, peak: -18.1 });
    expect(parseEbur128('ffmpeg wrote nothing useful')).toEqual({ lufs: null, peak: null });
  });

  it('brings a sound to the target', () => {
    expect(evenGainDb({ lufs: -22, peak: -12 })).toBeCloseTo(TARGET_LUFS + 22);
    expect(evenGainDb({ lufs: -9, peak: -1 })).toBeCloseTo(-5);
  });

  it('pushes a peak no further over the ceiling than the limiter can take back', () => {
    // -23 LUFS needs +9 dB; its -4 dBTP peak may only go up to -1 + 6.
    expect(evenGainDb({ lufs: -23, peak: -4 })).toBeCloseTo(PEAK_CEILING_DB + LIMITER_HEADROOM_DB + 4);
  });

  it('turns very quiet recordings up only so far', () => {
    expect(evenGainDb({ lufs: -50, peak: -40 })).toBe(MAX_BOOST_DB);
  });

  it('leaves alone what could not be measured, and everything when it is off', () => {
    expect(evenGainDb(null)).toBe(0);
    expect(evenGainDb(undefined)).toBe(0);
    expect(evenGainDb({ lufs: null, peak: -3 })).toBe(0);
    expect(evenGain({ lufs: -30, peak: -10 }, false)).toBe(1);
    expect(evenGain({ lufs: -20, peak: -10 }, true)).toBeCloseTo(dbToGain(6));
  });

  it('holds the limiter at the ceiling', () => {
    expect(20 * Math.log10(LIMITER.ceiling)).toBeCloseTo(PEAK_CEILING_DB);
  });
});
