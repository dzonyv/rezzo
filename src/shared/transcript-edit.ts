/**
 * Corrections to transcript words: new text, splitting, joining, deleting
 * and moving their timing.
 *
 * Each function changes `segments` in place and touches only the segments
 * it has to, so on an Immer draft an edit to one word of an hour-long
 * transcript is a small undo step rather than a copy of the whole thing.
 */
import type { Segment, Word } from './project.ts';
import { toLatin } from './transliterate.ts';

/** A word by its segment and its position in that segment. */
export interface WordRef {
  segment: number;
  word: number;
}

/** The shortest a word can become when timings are moved. */
export const MIN_WORD_SECONDS = 0.04;

const ms = (s: number) => Math.round(s * 1000) / 1000;

/** The words a typed correction turns into: Latin, split at spaces. */
export function wordsOfText(text: string): string[] {
  return toLatin(text).trim().split(/\s+/).filter(Boolean);
}

/** A segment's start and end follow its words. */
function fit(segment: Segment): void {
  segment.start = segment.words[0]!.start;
  segment.end = Math.max(...segment.words.map((w) => w.end));
}

function removeWord(segments: Segment[], at: WordRef): void {
  const segment = segments[at.segment]!;
  segment.words.splice(at.word, 1);
  if (segment.words.length === 0) segments.splice(at.segment, 1);
  else fit(segment);
}

/**
 * Splits one word's time between `texts`, by their length: "dobroveče"
 * typed as "dobro veče" keeps its start and end, and the break falls about
 * where the second word would begin.
 */
export function splitTime(word: Pick<Word, 'start' | 'end'>, texts: readonly string[]): { start: number; end: number }[] {
  const total = texts.reduce((n, t) => n + t.length, 0);
  const span = word.end - word.start;
  let done = 0;
  return texts.map((t) => {
    const start = word.start + (span * done) / total;
    done += t.length;
    return { start: ms(start), end: ms(word.start + (span * done) / total) };
  });
}

/**
 * Gives a word new text. Spaces split it into several words; empty text
 * deletes it (and its segment, if it was the only word). Corrected words
 * count as certain (p = 1). Returns how many words now stand in its place.
 */
export function setWordText(segments: Segment[], at: WordRef, text: string): number {
  const segment = segments[at.segment];
  const word = segment?.words[at.word];
  if (!segment || !word) return 0;
  const texts = wordsOfText(text);
  if (texts.length === 0) {
    removeWord(segments, at);
    return 0;
  }
  if (texts.length === 1 && texts[0] === word.text) return 1;
  const times = splitTime(word, texts);
  segment.words.splice(at.word, 1, ...texts.map((t, i) => ({ text: t, ...times[i]!, p: 1 })));
  fit(segment);
  return texts.length;
}

/** The word after `at`, which may be the first one of the next segment. */
export function nextRef(segments: readonly Segment[], at: WordRef): WordRef | null {
  if (at.word + 1 < segments[at.segment]!.words.length) return { segment: at.segment, word: at.word + 1 };
  return at.segment + 1 < segments.length ? { segment: at.segment + 1, word: 0 } : null;
}

/** The word before `at`, which may be the last one of the previous segment. */
export function previousRef(segments: readonly Segment[], at: WordRef): WordRef | null {
  if (at.word > 0) return { segment: at.segment, word: at.word - 1 };
  return at.segment > 0 ? { segment: at.segment - 1, word: segments[at.segment - 1]!.words.length - 1 } : null;
}

const wordOf = (segments: readonly Segment[], at: WordRef): Word => segments[at.segment]!.words[at.word]!;

/**
 * Joins a word with the next one into a single word ("futbal" + "ski" ->
 * "futbalski"), across a segment break if needed. Returns false when there
 * is no next word.
 */
export function mergeWithNext(segments: Segment[], at: WordRef): boolean {
  const next = nextRef(segments, at);
  if (!next) return false;
  const a = wordOf(segments, at);
  const b = wordOf(segments, next);
  Object.assign(a, { text: a.text + b.text, end: Math.max(a.end, b.end), p: 1 });
  removeWord(segments, next);
  fit(segments[at.segment]!);
  return true;
}

/**
 * Moves a word's start and end. Neighbours give way: a start before the
 * previous word's end pulls that end back, an end after the next word's
 * start pushes that start on, but no word gets shorter than
 * MIN_WORD_SECONDS and words never change order.
 */
export function setWordTiming(segments: Segment[], at: WordRef, start: number, end: number): void {
  const word = segments[at.segment]?.words[at.word];
  if (!word) return;
  const prevAt = previousRef(segments, at);
  const nextAt = nextRef(segments, at);
  const prev = prevAt && wordOf(segments, prevAt);
  const next = nextAt && wordOf(segments, nextAt);

  // The word may cover anything between these, leaving its neighbours their minimum.
  const lo = prev ? prev.start + MIN_WORD_SECONDS : 0;
  const hi = next ? next.end - MIN_WORD_SECONDS : Infinity;
  const s = Math.max(lo, Math.min(start, hi - MIN_WORD_SECONDS));
  const e = Math.max(s + MIN_WORD_SECONDS, Math.min(end, hi));

  word.start = ms(s);
  word.end = ms(e);
  if (prev && prev.end > word.start) {
    prev.end = word.start;
    fit(segments[prevAt.segment]!);
  }
  if (next && next.start < word.end) {
    next.start = word.end;
    next.end = Math.max(next.end, next.start);
    fit(segments[nextAt.segment]!);
  }
  fit(segments[at.segment]!);
}
