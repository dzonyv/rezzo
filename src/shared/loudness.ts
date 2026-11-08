/**
 * Evening out loudness: a sound is measured once (integrated loudness and
 * true peak, ITU-R BS.1770, with FFmpeg's ebur128 in the media worker) and
 * then turned up or down by one fixed gain, the same in the preview and
 * the export. Not a dynamic normalizer: quiet and loud moments keep their
 * difference, only the whole is moved.
 *
 * The gain brings the sound to TARGET_LUFS, as the short-video apps play
 * it, but never pushes its true peak more than LIMITER_HEADROOM_DB over
 * PEAK_CEILING_DB: the limiter at the end of the mix (see LIMITER) takes
 * the rest, and asking it for more than a few decibels would be heard.
 */

/** What a measurement says; null when the sound is too short or too quiet to measure. */
export interface Loudness {
  /** Integrated loudness, LUFS. */
  lufs: number | null;
  /** True peak, dBTP. */
  peak: number | null;
}

/** Where evened-out sound lands. */
export const TARGET_LUFS = -14;
/** The highest a peak may reach in the output; the limiter holds it there. */
export const PEAK_CEILING_DB = -1;
/** How far over the ceiling the gain may push a peak, for the limiter to bring back. */
export const LIMITER_HEADROOM_DB = 6;
/** Very quiet recordings are mostly noise when turned up this far. */
export const MAX_BOOST_DB = 20;
/** ebur128 reports this (its floor) for silence and sounds shorter than one 400 ms block. */
const UNMEASURED_LUFS = -69.5;

/** The limiter at the end of the mix: holds peaks at the ceiling, a few milliseconds ahead. */
export const LIMITER = { ceiling: 10 ** (PEAK_CEILING_DB / 20), attack: 0.005, release: 0.05 } as const;

/** The gain, in dB, that evens out a sound measured as `m`; 0 when it couldn't be measured. */
export function evenGainDb(m: Loudness | null | undefined): number {
  if (!m || m.lufs === null || m.lufs < UNMEASURED_LUFS) return 0;
  let gain = TARGET_LUFS - m.lufs;
  if (m.peak !== null) gain = Math.min(gain, PEAK_CEILING_DB + LIMITER_HEADROOM_DB - m.peak);
  return Math.min(MAX_BOOST_DB, gain);
}

export const dbToGain = (db: number): number => 10 ** (db / 20);

/** The factor that evens out a sound measured as `m`, or 1 when evening out is off. */
export const evenGain = (m: Loudness | null | undefined, on: boolean): number => (on ? dbToGain(evenGainDb(m)) : 1);

/** Reads the summary ebur128 writes at the end (its last "I:" and "Peak:" lines). */
export function parseEbur128(stderr: string): Loudness {
  const last = (re: RegExp): number | null => {
    const all = [...stderr.matchAll(re)];
    const v = all.length > 0 ? Number(all.at(-1)![1]) : NaN;
    return Number.isFinite(v) ? v : null;
  };
  const lufs = last(/^\s*I:\s+(-?[\d.]+|-?inf)\s+LUFS/gm);
  return { lufs: lufs !== null && lufs < UNMEASURED_LUFS ? null : lufs, peak: last(/^\s*Peak:\s+(-?[\d.]+|-?inf)\s+dBFS/gm) };
}
