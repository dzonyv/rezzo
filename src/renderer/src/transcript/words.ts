/** The transcript as one flat list of words, plus lookups by time. */
import type { Segment, Word } from '../../../shared/project.ts';

export interface FlatWord extends Word {
  /** Position in the flat list. */
  index: number;
  segment: number;
}

export interface FlatTranscript {
  words: FlatWord[];
  /** Index of each segment's first word. */
  segmentStart: number[];
}

export function flatten(segments: Segment[]): FlatTranscript {
  const words: FlatWord[] = [];
  const segmentStart: number[] = [];
  segments.forEach((s, segment) => {
    segmentStart.push(words.length);
    for (const w of s.words) words.push({ ...w, index: words.length, segment });
  });
  return { words, segmentStart };
}

/**
 * The word being spoken at `time`: the last word that has started, as long
 * as the next one hasn't. Between sentences it stays on the previous word
 * until the next starts; before the first word there is none (-1).
 */
export function wordAt(words: readonly Word[], time: number): number {
  let lo = 0;
  let hi = words.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid]!.start <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
