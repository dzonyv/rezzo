/**
 * The frame grid. A clip's working file runs at one constant frame rate
 * chosen per source, and its frames sit at n / rate seconds from the start
 * of the source, so keyframes and clip edges snap to the same grid the
 * working file and the export use.
 */
import type { Source } from './project.ts';

export type FrameRate = [number, number];

/** Rates the working file uses; anything else maps to the nearest one. */
const STANDARD_RATES: FrameRate[] = [
  [24000, 1001], [24, 1], [25, 1], [30000, 1001], [30, 1], [50, 1], [60000, 1001], [60, 1],
];

export const fps = ([num, den]: FrameRate): number => num / den;

/**
 * The working file's frame rate for a source. Camera rates are kept as
 * they are; odd ones (a variable-rate file that reports 1000/1, a 15 fps
 * webcam, 120 fps slow motion) become the nearest standard rate, at most 60.
 */
export function workingFrameRate(source: Pick<Source, 'video'>): FrameRate {
  const rate = fps(source.video.frameRate);
  let best = STANDARD_RATES[0]!;
  for (const r of STANDARD_RATES) {
    if (Math.abs(fps(r) - rate) < Math.abs(fps(best) - rate)) best = r;
  }
  return best;
}

/** Frame number of `time` on the grid (the nearest frame). */
export const frameAt = (time: number, rate: FrameRate): number => Math.round(time * fps(rate) + 1e-9);

export const timeOfFrame = (frame: number, rate: FrameRate): number => (frame * rate[1]) / rate[0];

export const snapToFrame = (time: number, rate: FrameRate): number => timeOfFrame(frameAt(time, rate), rate);

/** Whether two times fall on the same frame. */
export const sameFrame = (a: number, b: number, rate: FrameRate): boolean => frameAt(a, rate) === frameAt(b, rate);
