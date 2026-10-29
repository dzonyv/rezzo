/**
 * Transcript search that forgives what people leave out when typing fast:
 * case, diacritics (c finds č and ć) and punctuation. "đ" is found by
 * "dj" or by "d", since people write it both ways.
 */
import type { Word } from '../../../shared/project.ts';

/** A match covers words first..last (inclusive). */
export interface Match {
  first: number;
  last: number;
}

/** Lowercase, no diacritics, letters and digits only; đ becomes `dj` (variant 0) or `d` (variant 1). */
export function fold(text: string, variant: 0 | 1 = 0): string {
  return text
    .toLowerCase()
    .replace(/đ/g, variant === 0 ? 'dj' : 'd')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

interface Folded {
  /** All words folded and joined with single spaces. */
  text: string;
  /** For each character of `text`, the word it belongs to. */
  wordOf: Int32Array;
}

export interface SearchIndex {
  variants: [Folded, Folded];
}

export function buildIndex(words: readonly Word[]): SearchIndex {
  const build = (variant: 0 | 1): Folded => {
    const parts: string[] = [];
    const owners: number[] = [];
    words.forEach((w, i) => {
      const f = fold(w.text, variant);
      if (!f) return;
      if (parts.length > 0) {
        parts.push(' ');
        owners.push(i);
      }
      parts.push(f);
      for (let k = 0; k < f.length; k++) owners.push(i);
    });
    return { text: parts.join(''), wordOf: Int32Array.from(owners) };
  };
  return { variants: [build(0), build(1)] };
}

/** Normalizes a query the same way, keeping single spaces between its words. */
function foldQuery(query: string, variant: 0 | 1): string {
  return query
    .split(/\s+/)
    .map((part) => fold(part, variant))
    .filter(Boolean)
    .join(' ');
}

/** Every place the query occurs, in transcript order. Matches may start or end inside a word. */
export function search(index: SearchIndex, query: string, limit = 5000): Match[] {
  const found = new Map<number, Match>();
  for (const variant of [0, 1] as const) {
    const q = foldQuery(query, variant);
    if (!q) continue;
    const { text, wordOf } = index.variants[variant];
    for (let at = text.indexOf(q); at !== -1 && found.size < limit; at = text.indexOf(q, at + 1)) {
      const first = wordOf[at]!;
      if (!found.has(first)) found.set(first, { first, last: wordOf[at + q.length - 1]! });
    }
  }
  return [...found.values()].sort((a, b) => a.first - b.first);
}
