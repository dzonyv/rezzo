/**
 * "Quieter while someone talks": a sound layer (usually music) is turned
 * down under the clip's speech and back up in the gaps. Where the speech
 * is comes from the clip's own sound, measured once in the media worker
 * (one level per DUCK_STEP of what the clip plays, so in output time) and
 * split at the same quiet limit pauses use. The gain is a straight line
 * between corners, so the preview (Web Audio ramps) and the export (a gain
 * signal FFmpeg multiplies the sound by) turn it down the same way.
 */
import { quietLimit, type Span } from './skips.ts';
import { dbToGain } from './loudness.ts';

/** Seconds per level in a measurement of the clip's sound. */
export const DUCK_STEP = 0.02;
/** How far a sound can be turned down, dB. */
export const MIN_DUCK_DB = 6;
export const MAX_DUCK_DB = 24;
export const DEFAULT_DUCK_DB = 12;
/** A file of the user's own this long or longer is turned down from the start: it's most likely music. */
export const DUCK_BY_DEFAULT_SECONDS = 10;
/** Turning down starts this long before speech, so the first word is already clear. */
const DOWN_SECONDS = 0.15;
/** And back up over this long after it. */
const UP_SECONDS = 0.4;
/** A gap in speech shorter than this stays down: music swelling between two sentences pumps. */
const HOLD_SECONDS = 0.5;
/** Louder stretches shorter than this are a cough or a click, not speech. */
const MIN_SPEECH_SECONDS = 0.1;
/** What a level of no sound at all (FFmpeg's -inf) counts as. */
const SILENT_DB = -100;

/** A sound layer's setting: whether it's turned down under speech, and by how much (dB). */
export interface Duck {
  on: boolean;
  db: number;
}

/** A corner of a gain that goes in straight lines: `gain` at output time `t`. */
export interface GainPoint {
  t: number;
  gain: number;
}

/** Reads the levels FFmpeg's astats prints, one per line "…RMS_level=<dB>", in order. */
export function parseLevels(stderr: string): number[] {
  return [...stderr.matchAll(/lavfi\.astats\.Overall\.RMS_level=(-?inf|-?[\d.]+)/g)].map((m) => {
    const v = Number(m[1]);
    return Number.isFinite(v) ? Math.max(SILENT_DB, v) : SILENT_DB;
  });
}

/**
 * Where someone talks, in output time, from the clip's levels: stretches
 * over the quiet limit, joined over short gaps. Null when speech can't be
 * told from the rest (music under everything, or no sound), so nothing is
 * turned down.
 */
export function speechOf(levels: readonly number[], step = DUCK_STEP): Span[] | null {
  const limit = quietLimit(levels);
  if (limit === null) return null;
  const spans: Span[] = [];
  let begun: number | null = null;
  const close = (end: number) => {
    if (begun === null) return;
    const last = spans.at(-1);
    if (last && begun - last.end < HOLD_SECONDS) last.end = end;
    else spans.push({ start: begun, end });
    begun = null;
  };
  levels.forEach((db, i) => {
    if (db >= limit) begun ??= i * step;
    else close(i * step);
  });
  close(levels.length * step);
  return spans.filter((s) => s.end - s.start >= MIN_SPEECH_SECONDS);
}

/**
 * The gain's corners for a sound turned down by `db` under `speech`: 1
 * away from it, down to the lower gain just before each stretch, and back
 * up after it. Stretches whose slopes would meet are taken as one. Empty
 * when there's no speech.
 */
export function duckPoints(speech: readonly Span[], db: number): GainPoint[] {
  const low = dbToGain(-db);
  const joined: Span[] = [];
  for (const s of speech) {
    const last = joined.at(-1);
    if (last && s.start - DOWN_SECONDS <= last.end + UP_SECONDS) last.end = Math.max(last.end, s.end);
    else joined.push({ ...s });
  }
  return joined.flatMap((s) => [
    { t: s.start - DOWN_SECONDS, gain: 1 },
    { t: s.start, gain: low },
    { t: s.end, gain: low },
    { t: s.end + UP_SECONDS, gain: 1 },
  ]);
}

/** The gain at output time `t`: 1 before the first corner and after the last, a straight line between. */
export function duckGainAt(points: readonly GainPoint[], t: number): number {
  const first = points[0];
  if (!first || t <= first.t) return first?.gain ?? 1;
  for (let i = 1; i < points.length; i++) {
    const b = points[i]!;
    if (t <= b.t) {
      const a = points[i - 1]!;
      return b.t === a.t ? b.gain : a.gain + ((b.gain - a.gain) * (t - a.t)) / (b.t - a.t);
    }
  }
  return points.at(-1)!.gain;
}

/** The corners from output time `from` on, starting with the gain there: what Web Audio's ramps need. */
export function duckPointsFrom(points: readonly GainPoint[], from: number): GainPoint[] {
  if (points.length === 0) return [];
  return [{ t: from, gain: duckGainAt(points, from) }, ...points.filter((p) => p.t > from)];
}

/** The gain, sampled `rate` times a second from output time `at` for `seconds`: the signal the export multiplies a sound by. */
export function duckSignal(points: readonly GainPoint[], at: number, seconds: number, rate: number): Float32Array {
  const out = new Float32Array(Math.max(0, Math.round(seconds * rate)));
  // Walks the corners once rather than looking each sample up: a minute is millions of samples.
  let next = 0;
  for (let i = 0; i < out.length; i++) {
    const t = at + i / rate;
    while (next < points.length && points[next]!.t < t) next++;
    const a = points[next - 1];
    const b = points[next];
    if (!a) out[i] = b?.gain ?? 1;
    else if (!b) out[i] = a.gain;
    else out[i] = a.gain + ((b.gain - a.gain) * (t - a.t)) / (b.t - a.t);
  }
  return out;
}
