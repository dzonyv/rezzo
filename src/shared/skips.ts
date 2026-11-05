/**
 * What a clip leaves out. A skip is a stretch of the source inside a clip
 * that doesn't play and isn't exported: a pause, or words the user cut.
 *
 * Every time in the project stays in source seconds, so keyframes, captions
 * and layers don't move when a skip is added or taken back. Only three things
 * know about skips: the player, the export and the timeline. "Output time"
 * below is seconds into what's left, from the clip's start.
 */
import { fps, snapToFrame, timeOfFrame, type FrameRate } from './frames.ts';
import type { Clip, Word } from './project.ts';
import type { Span } from './voices.ts';

export type { Span };

export type ClipSpan = Pick<Clip, 'start' | 'end' | 'skips'>;

/** A kept piece shorter than this is a blip, not something to hear: it's cut too. */
export const MIN_PIECE_SECONDS = 0.1;
/** Sound fades out and back in over this long on each side of a join, so it doesn't click. */
export const JOIN_FADE_SECONDS = 0.01;

function pieces(clip: ClipSpan): Span[] {
  const kept: Span[] = [];
  let t = clip.start;
  for (const skip of clip.skips) {
    if (skip.end <= clip.start || skip.start >= clip.end) continue;
    if (skip.start > t) kept.push({ start: t, end: skip.start });
    t = Math.max(t, skip.end);
  }
  if (t < clip.end) kept.push({ start: t, end: clip.end });
  return kept;
}

/**
 * The stretches of the source the clip plays, in order. Skips outside the
 * clip are ignored, so they come back if it's made longer. A clip trimmed
 * down to nothing but skips plays whole rather than not at all.
 */
export function keptPieces(clip: ClipSpan): Span[] {
  const kept = pieces(clip);
  return kept.length > 0 ? kept : [{ start: clip.start, end: clip.end }];
}

export const keptLength = (clip: ClipSpan): number => keptPieces(clip).reduce((sum, p) => sum + p.end - p.start, 0);

/**
 * Output time of source time `t`. Inside a skip that's where the next piece
 * starts. Outside the clip it runs on from the clip's ends, which a layer
 * that starts before the clip needs.
 */
export function outputTime(clip: ClipSpan, t: number): number {
  if (t <= clip.start) return t - clip.start;
  let out = 0;
  for (const p of keptPieces(clip)) {
    if (t <= p.start) return out;
    if (t < p.end) return out + t - p.start;
    out += p.end - p.start;
  }
  return out + Math.max(0, t - clip.end);
}

/** The first moment at or after `t` that plays, or null when nothing does. */
export function nextKept(clip: ClipSpan, t: number): number | null {
  for (const p of keptPieces(clip)) if (t < p.end) return Math.max(t, p.start);
  return null;
}

/**
 * Where a layer with its own playback (a video, an animation) has got to at
 * source time `t`: it doesn't jump at a skip, so the time skipped since the
 * layer's start is taken off.
 */
export function layerClock(clip: ClipSpan, layerStart: number, t: number): number {
  if (clip.skips.length === 0) return t;
  return layerStart + outputTime(clip, t) - outputTime(clip, layerStart);
}

/**
 * The clip's skips with `spans` added: on whole frames, joined where they
 * touch, with no blip left between two of them or next to the clip's ends.
 * Spans that would leave nothing of the clip aren't added.
 */
export function withSkips(clip: ClipSpan, spans: readonly Span[], rate: FrameRate): Span[] {
  const all = [...clip.skips, ...spans.map((s) => ({ start: snapToFrame(s.start, rate), end: snapToFrame(s.end, rate) }))]
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const joined: Span[] = [];
  for (const s of all) {
    const last = joined.at(-1);
    if (last && s.start - last.end < MIN_PIECE_SECONDS) last.end = Math.max(last.end, s.end);
    else joined.push({ ...s });
  }
  const inside = joined.filter((s) => s.end > clip.start && s.start < clip.end);
  const first = inside[0];
  const final = inside.at(-1);
  if (first && first.start > clip.start && first.start - clip.start < MIN_PIECE_SECONDS) first.start = clip.start;
  if (final && final.end < clip.end && clip.end - final.end < MIN_PIECE_SECONDS) final.end = clip.end;
  return pieces({ ...clip, skips: joined }).length > 0 ? joined : clip.skips;
}

/** The clip's skips without the one at `t`. */
export const withoutSkipAt = (clip: Pick<Clip, 'skips'>, t: number): Span[] => clip.skips.filter((s) => !(t >= s.start && t < s.end));

/** The range to cut for these words: from the first's start to the last's end. */
export function wordsSpan(words: readonly Pick<Word, 'start' | 'end'>[], rate: FrameRate): Span | null {
  const first = words[0];
  const last = words.at(-1);
  if (!first || !last) return null;
  const f = fps(rate);
  return { start: timeOfFrame(Math.floor(first.start * f + 1e-9), rate), end: timeOfFrame(Math.ceil(last.end * f - 1e-9), rate) };
}

/** Loudness in dB, one value per `step` seconds from source time `start`. */
export interface Loudness {
  db: Float32Array;
  step: number;
  start: number;
}

export interface PauseOptions {
  /** The shortest quiet stretch that counts, in seconds. */
  minPause: number;
  /** How much of a pause stays on each side, in seconds. */
  air: number;
}

export const DEFAULT_PAUSE_OPTIONS: PauseOptions = { minPause: 0.5, air: 0.1 };

/** Where "quiet" starts between a clip's noise floor (0) and its speech (1). Measured in spikes/REPORT.md. */
const QUIET_LIMIT = 0.35;
/** With less than this between floor and speech (music under everything), nothing can be told apart. */
const MIN_RANGE_DB = 10;
/** A louder moment this short doesn't end a pause. */
const BRIDGE_SECONDS = 0.06;

const percentile = (sorted: readonly number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

function quietRuns({ db, step, start }: Loudness, from: number, to: number, limit: number): Span[] {
  const runs: Span[] = [];
  let begun: number | null = null;
  const close = (t: number) => {
    if (begun === null) return;
    const last = runs.at(-1);
    if (last && begun - last.end <= BRIDGE_SECONDS) last.end = t;
    else runs.push({ start: begun, end: t });
    begun = null;
  };
  for (let i = from; i < to; i++) {
    const t = start + i * step;
    if (db[i]! < limit) begun ??= t;
    else close(t);
  }
  close(start + to * step);
  return runs;
}

/** `span` with every word taken out of it. */
function clearOfWords(span: Span, words: readonly Pick<Word, 'start' | 'end'>[]): Span[] {
  const out: Span[] = [];
  let t = span.start;
  for (const w of words) {
    if (w.end <= t) continue;
    if (w.start >= span.end) break;
    if (w.start > t) out.push({ start: t, end: w.start });
    t = w.end;
  }
  if (t < span.end) out.push({ start: t, end: span.end });
  return out;
}

/**
 * The pauses in a clip that could be cut, already narrowed by `air`. They
 * come from the sound: gaps in the transcript are mostly not quiet, since a
 * word's sound runs well past its end time. `words` (in order) only make sure
 * no word is cut. What counts as quiet is set per clip, between its own noise
 * floor and speech level. A pause already in a skip isn't offered again.
 */
export function pausesOf(clip: ClipSpan, words: readonly Pick<Word, 'start' | 'end'>[], sound: Loudness, { minPause, air }: PauseOptions): Span[] {
  const from = Math.max(0, Math.ceil((clip.start - sound.start) / sound.step));
  const to = Math.min(sound.db.length, Math.floor((clip.end - sound.start) / sound.step));
  if (to <= from) return [];
  const sorted = Array.from(sound.db.subarray(from, to)).sort((a, b) => a - b);
  const floor = percentile(sorted, 0.05);
  const speech = percentile(sorted, 0.8);
  if (speech - floor < MIN_RANGE_DB) return [];
  return quietRuns(sound, from, to, floor + QUIET_LIMIT * (speech - floor))
    .flatMap((run) => clearOfWords(run, words))
    .filter((p) => p.end - p.start >= minPause)
    .map((p) => ({ start: p.start + air, end: p.end - air }))
    .filter((p) => p.end > p.start && !clip.skips.some((s) => p.start < s.end && p.end > s.start));
}
