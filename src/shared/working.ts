/**
 * Planning working files: which stretch of the source a clip's working
 * file covers, and how it's named in the cache.
 *
 * A working file reaches a little past both ends of its clip, so trimming
 * the clip by a second or two keeps using the same file instead of
 * converting again.
 */
import { fps, timeOfFrame, type FrameRate } from './frames.ts';
import type { Source } from './project.ts';

export const WORKING_MARGIN_SECONDS = 2;
/** Bumped when the conversion changes, so old cached files aren't reused. */
export const WORKING_VERSION = 1;

/** A stretch of the source in whole frames: [first, end). */
export interface WorkingSpan {
  first: number;
  end: number;
  rate: FrameRate;
}

export function workingSpan(range: { start: number; end: number }, source: Pick<Source, 'duration'>, rate: FrameRate): WorkingSpan {
  const f = fps(rate);
  const lastFrame = Math.floor(source.duration * f);
  return {
    first: Math.max(0, Math.floor((range.start - WORKING_MARGIN_SECONDS) * f + 1e-9)),
    end: Math.min(lastFrame, Math.ceil((range.end + WORKING_MARGIN_SECONDS) * f - 1e-9)),
    rate,
  };
}

export const spanStart = (span: WorkingSpan): number => timeOfFrame(span.first, span.rate);
export const spanEnd = (span: WorkingSpan): number => timeOfFrame(span.end, span.rate);

/** Whether the span holds every frame of `range`. */
export function spanCovers(span: WorkingSpan, range: { start: number; end: number }): boolean {
  return spanStart(span) <= range.start + 1e-6 && spanEnd(span) >= range.end - 1e-6;
}

/** "1500-3300@30000-1001.v1.mp4": frames, frame rate, conversion version. */
export function workingFileName(span: WorkingSpan): string {
  return `${span.first}-${span.end}@${span.rate[0]}-${span.rate[1]}.v${WORKING_VERSION}.mp4`;
}

export function parseWorkingFileName(name: string): WorkingSpan | null {
  const m = /^(\d+)-(\d+)@(\d+)-(\d+)\.v(\d+)\.mp4$/.exec(name);
  if (!m || Number(m[5]) !== WORKING_VERSION) return null;
  return { first: Number(m[1]), end: Number(m[2]), rate: [Number(m[3]), Number(m[4])] };
}

/** Where a working file sits in the source: its frame 0 is at `start` seconds. */
export interface WorkingPlacement {
  start: number;
  frameRate: FrameRate;
}

/**
 * The working file's frame on screen at source time `time` (the last one
 * that started at or before it). The preview and the export both pick
 * frames with this, so they show the same ones.
 */
export const workingFrameIndex = (file: WorkingPlacement, time: number): number =>
  Math.floor((time - file.start) * fps(file.frameRate) + 1e-6);

/** Source time of working-file frame `index`. */
export const workingFrameTime = (file: WorkingPlacement, index: number): number => file.start + index / fps(file.frameRate);

/** The working-file frames a clip covers: `count` frames from `first`. */
export function clipFrames(file: WorkingPlacement, range: { start: number; end: number }): { first: number; count: number } {
  const first = workingFrameIndex(file, range.start);
  return { first, count: Math.max(0, workingFrameIndex(file, range.end) - first) };
}
