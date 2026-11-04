/**
 * Telling voices apart, from the transcript (spikes/REPORT.md, Phase 4
 * checks): the words are joined into pieces at pauses, the media worker takes
 * a speaker embedding of each piece, and the pieces are clustered here into
 * voices. A voice is a number; who it belongs to is the user's to say.
 *
 * The result is derived from the source and the transcript, so it lives in
 * the cache (`voices.v1.json`), not in the project.
 */
import { z } from 'zod';

/** Bumped when the result would come out differently, so old caches are redone. */
export const VOICES_VERSION = 2;

/** A pause this long ends a piece; speaker changes rarely happen without one. */
export const PIECE_GAP = 0.3;
/** Longest piece, in seconds. */
export const PIECE_MAX = 3;
/** Pieces at least this long decide the voices; shorter ones join the nearest. */
export const CLUSTER_MIN = 1;
/** Cosine distance at which two groups of pieces count as different voices. */
export const VOICE_THRESHOLD = 0.7;
/** Neighbouring pieces of one voice closer than this are one turn. */
export const TURN_GAP = 1.5;

export const MAX_SPEAKERS = 8;
/** The project's "how many people talk" setting: found from the audio, or given. */
export const speakerCountSchema = z.union([z.literal('auto'), z.number().int().min(1).max(MAX_SPEAKERS)]);
export type SpeakerCount = z.infer<typeof speakerCountSchema>;

export interface Span {
  start: number;
  end: number;
}

const seconds = z.number().finite().nonnegative();
const unit = z.number().min(0).max(1);

export const voiceTurnSchema = z.object({ start: seconds, end: seconds, voice: z.number().int().nonnegative() });
export type VoiceTurn = z.infer<typeof voiceTurnSchema>;

export const episodeVoicesSchema = z.object({
  version: z.literal(VOICES_VERSION),
  /** A hash of what it was made from (the pieces, the model, the count), so any change makes it stale. */
  key: z.string(),
  count: speakerCountSchema,
  voices: z.number().int().nonnegative(),
  turns: z.array(voiceTurnSchema),
});
export type EpisodeVoices = z.infer<typeof episodeVoicesSchema>;

/**
 * A correction to the voices, kept in the project in the order it was made.
 * A voice's number holds only for one result (changing the count or the
 * words renumbers them), so a correction names a voice by a moment it talks
 * at, as the voices stood when it was made. Replaying them works on any result.
 */
export const voiceEditSchema = z.discriminatedUnion('kind', [
  /** The voice at `at` has a name; an empty one takes it away. */
  z.object({ kind: z.literal('name'), at: seconds, name: z.string() }),
  /** The voice at `at` is the same person as the voice at `into`. */
  z.object({ kind: z.literal('merge'), at: seconds, into: seconds }),
  /** Whoever talks from `start` to `end` is the voice at `as`, a new voice, or nobody. */
  z.object({ kind: z.literal('turn'), start: seconds, end: seconds, as: z.union([seconds, z.literal('new'), z.null()]) }),
  /** The turn around `at` is really two. */
  z.object({ kind: z.literal('split'), at: seconds }),
]);
export type VoiceEdit = z.infer<typeof voiceEditSchema>;

/**
 * "At `t` the person at (x, y) is the one talking", from a click. The point
 * is in 0..1 of the source, not a seat of the analysis, so it means the same
 * after a new analysis and in every clip of the episode. `size` is their head
 * as a share of the picture's width, which tells one camera angle from another.
 */
export const speakerPickSchema = z.object({ t: seconds, x: unit, y: unit, size: z.number().positive().max(1) });
export type SpeakerPick = z.infer<typeof speakerPickSchema>;

/** Words joined into pieces, split at pauses of `gap` and at `max` seconds. */
export function piecesOf(words: readonly Span[], gap = PIECE_GAP, max = PIECE_MAX): Span[] {
  const pieces: Span[] = [];
  for (const w of [...words].sort((a, b) => a.start - b.start)) {
    if (w.end <= w.start) continue;
    const last = pieces.at(-1);
    if (last && w.start - last.end < gap && w.end - last.start <= max) last.end = Math.max(last.end, w.end);
    else pieces.push({ start: w.start, end: w.end });
  }
  return pieces;
}

export function normalised(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Float32Array.from(v, (x) => x / n);
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

export interface Merge {
  /** One original index from each side of the merge. */
  a: number;
  b: number;
  distance: number;
}

/**
 * Every merge of average-linkage clustering on cosine distance, closest
 * first. Vectors must be normalised. Nearest-neighbour chain: O(n²) time and
 * one n×n matrix, about a second for an hour of speech.
 */
export function dendrogram(vectors: readonly Float32Array[]): Merge[] {
  const n = vectors.length;
  const d = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) d[i * n + j] = d[j * n + i] = 1 - dot(vectors[i]!, vectors[j]!);
  const size = new Array<number>(n).fill(1);
  const active = new Set<number>(Array.from({ length: n }, (_, i) => i));
  const merges: Merge[] = [];
  const chain: number[] = [];
  while (active.size > 1) {
    if (chain.length === 0) chain.push(active.values().next().value!);
    const a = chain[chain.length - 1]!;
    const prev = chain.length > 1 ? chain[chain.length - 2] : undefined;
    // Prefer the previous link on ties, or the chain can cycle.
    let b = prev ?? -1;
    let best = prev === undefined ? Infinity : d[a * n + prev]!;
    for (const k of active) {
      if (k !== a && d[a * n + k]! < best) {
        best = d[a * n + k]!;
        b = k;
      }
    }
    if (b !== prev) {
      chain.push(b);
      continue;
    }
    chain.length -= 2;
    merges.push({ a, b, distance: best });
    // Lance–Williams for average linkage; the merged group keeps slot a.
    const sa = size[a]!;
    const sb = size[b]!;
    for (const k of active) {
      if (k === a || k === b) continue;
      d[a * n + k] = d[k * n + a] = (sa * d[a * n + k]! + sb * d[b * n + k]!) / (sa + sb);
    }
    size[a] = sa + sb;
    active.delete(b);
  }
  return merges.sort((x, y) => x.distance - y.distance);
}

/** Group per vector, numbered by first appearance, after merging up to `threshold` or down to `k` groups. */
export function cutDendrogram(n: number, merges: readonly Merge[], stop: { threshold: number } | { k: number }): number[] {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
    return i;
  };
  const count = 'k' in stop ? Math.max(0, n - stop.k) : merges.filter((m) => m.distance <= stop.threshold).length;
  for (const m of merges.slice(0, count)) parent[find(m.a)] = find(m.b);
  const ids = new Map<number, number>();
  return Array.from({ length: n }, (_, i) => {
    const r = find(i);
    if (!ids.has(r)) ids.set(r, ids.size);
    return ids.get(r)!;
  });
}

/**
 * A voice per piece. The pieces of at least CLUSTER_MIN seconds are
 * clustered; every piece then takes the voice whose centre is nearest.
 * Voices are numbered by how much they talk, most first.
 */
export function voicesOf(pieces: readonly Span[], embeddings: readonly Float32Array[], count: SpeakerCount): number[] {
  if (pieces.length === 0) return [];
  const vectors = embeddings.map(normalised);
  const long = (i: number) => pieces[i]!.end - pieces[i]!.start >= CLUSTER_MIN;
  let decide = pieces.map((_, i) => i).filter(long);
  if (decide.length === 0) decide = pieces.map((_, i) => i);
  const groups = cutDendrogram(
    decide.length,
    dendrogram(decide.map((i) => vectors[i]!)),
    count === 'auto' ? { threshold: VOICE_THRESHOLD } : { k: Math.min(count, decide.length) },
  );
  const k = Math.max(...groups) + 1;
  const dim = vectors[0]!.length;
  const sums = Array.from({ length: k }, () => new Float32Array(dim));
  decide.forEach((i, x) => {
    const sum = sums[groups[x]!]!;
    vectors[i]!.forEach((v, j) => (sum[j] = sum[j]! + v));
  });
  const centres = sums.map(normalised);
  const raw = vectors.map((v) => {
    let best = 0;
    let bestDot = -Infinity;
    centres.forEach((c, g) => {
      const s = dot(v, c);
      if (s > bestDot) {
        bestDot = s;
        best = g;
      }
    });
    return best;
  });
  const talk = new Array<number>(k).fill(0);
  raw.forEach((g, i) => (talk[g] = talk[g]! + pieces[i]!.end - pieces[i]!.start));
  const order = talk.map((t, g) => ({ t, g })).sort((a, b) => b.t - a.t || a.g - b.g);
  const rank = new Map(order.map((o, r) => [o.g, r]));
  return raw.map((g) => rank.get(g)!);
}

/** Neighbouring pieces of the same voice joined into turns. */
export function turnsOf(pieces: readonly Span[], voices: readonly number[], gap = TURN_GAP): VoiceTurn[] {
  const turns: VoiceTurn[] = [];
  pieces.forEach((p, i) => {
    const voice = voices[i]!;
    const last = turns.at(-1);
    if (last && last.voice === voice && p.start - last.end < gap) last.end = p.end;
    else turns.push({ start: p.start, end: p.end, voice });
  });
  return turns;
}

/** The voice talking at `t`, or null. Turns are sorted and don't overlap. */
export function voiceAt(turns: readonly VoiceTurn[], t: number): number | null {
  let lo = 0;
  let hi = turns.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const turn = turns[mid]!;
    if (turn.end <= t) lo = mid + 1;
    else if (turn.start > t) hi = mid - 1;
    else return turn.voice;
  }
  return null;
}

/** The turn nearest to `t`, or null when there are none. */
export function turnNear(turns: readonly VoiceTurn[], t: number): VoiceTurn | null {
  let best: VoiceTurn | null = null;
  let bestD = Infinity;
  for (const turn of turns) {
    const d = Math.max(turn.start - t, t - turn.end, 0);
    if (d < bestD) {
      bestD = d;
      best = turn;
    }
  }
  return best;
}

export interface HeardVoice {
  id: number;
  /** What the user calls it, if they have. */
  name: string | null;
  /** Seconds it talks. */
  seconds: number;
  /** A moment it talks at, for corrections to name it by. */
  at: number;
}

export interface HeardVoices {
  turns: VoiceTurn[];
  voices: HeardVoice[];
}

/** What's left of a turn outside `start`..`end`. */
function outside(turn: VoiceTurn, start: number, end: number): VoiceTurn[] {
  if (turn.end <= start || turn.start >= end) return [turn];
  const left = turn.start < start ? [{ ...turn, end: start }] : [];
  const right = turn.end > end ? [{ ...turn, start: end }] : [];
  return [...left, ...right];
}

/** The voices as found, with the user's corrections replayed over them in order. */
export function heardVoices(found: Pick<EpisodeVoices, 'voices' | 'turns'>, edits: readonly VoiceEdit[]): HeardVoices {
  let turns: VoiceTurn[] = found.turns;
  let unused = found.voices;
  const names = new Map<number, string>();
  const voiceNear = (t: number) => turnNear(turns, t)?.voice ?? null;

  for (const edit of edits) {
    if (edit.kind === 'name') {
      const voice = voiceNear(edit.at);
      if (voice === null) continue;
      if (edit.name) names.set(voice, edit.name);
      else names.delete(voice);
    } else if (edit.kind === 'merge') {
      const from = voiceNear(edit.at);
      const into = voiceNear(edit.into);
      if (from === null || into === null || from === into) continue;
      turns = turns.map((t) => (t.voice === from ? { ...t, voice: into } : t));
      const name = names.get(from);
      if (name !== undefined && !names.has(into)) names.set(into, name);
      names.delete(from);
    } else if (edit.kind === 'split') {
      turns = turns.flatMap((t) => (t.start < edit.at && edit.at < t.end ? [{ ...t, end: edit.at }, { ...t, start: edit.at }] : [t]));
    } else {
      const voice = edit.as === 'new' ? unused++ : edit.as === null ? null : voiceNear(edit.as);
      if (edit.as !== null && voice === null) continue;
      turns = turns.flatMap((t) => outside(t, edit.start, edit.end));
      if (voice !== null) turns = [...turns, { start: edit.start, end: edit.end, voice }].sort((a, b) => a.start - b.start);
    }
  }

  const voices = new Map<number, HeardVoice & { longest: number }>();
  for (const turn of turns) {
    const length = turn.end - turn.start;
    const voice = voices.get(turn.voice) ?? { id: turn.voice, name: names.get(turn.voice) ?? null, seconds: 0, at: turn.start, longest: 0 };
    voice.seconds += length;
    if (length > voice.longest) {
      voice.longest = length;
      voice.at = (turn.start + turn.end) / 2;
    }
    voices.set(turn.voice, voice);
  }
  return { turns, voices: [...voices.values()].sort((a, b) => a.id - b.id).map(({ longest: _, ...voice }) => voice) };
}
