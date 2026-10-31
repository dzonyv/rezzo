/** The transcript as one flat list of words, plus lookups by time. */
import type { Segment, Word } from '../../../shared/project.ts';
import type { WordRef } from '../../../shared/transcript-edit.ts';

export interface FlatWord extends Word {
  /** Position in the flat list. */
  index: number;
  segment: number;
  /**
   * When the word counts as reached during playback: its start, but never
   * earlier than the word before (DTW starts can step back a little), so
   * the list stays sorted for wordAt().
   */
  reachedAt: number;
}

export interface FlatTranscript {
  words: FlatWord[];
  /** Index of each segment's first word. */
  segmentStart: number[];
}

export function flatten(segments: Segment[]): FlatTranscript {
  const words: FlatWord[] = [];
  const segmentStart: number[] = [];
  let reachedAt = 0;
  segments.forEach((s, segment) => {
    segmentStart.push(words.length);
    for (const w of s.words) {
      reachedAt = Math.max(reachedAt, w.start);
      words.push({ ...w, index: words.length, segment, reachedAt });
    }
  });
  return { words, segmentStart };
}

/**
 * The word being spoken at `time`: the last word that has started, as long
 * as the next one hasn't. Between sentences it stays on the previous word
 * until the next starts; before the first word there is none (-1).
 */
export function wordAt(words: readonly FlatWord[], time: number): number {
  let lo = 0;
  let hi = words.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid]!.reachedAt <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Where a word of the flat list sits in the transcript's segments. */
export function refOf(flat: FlatTranscript, index: number): WordRef {
  const segment = flat.words[index]!.segment;
  return { segment, word: index - flat.segmentStart[segment]! };
}
