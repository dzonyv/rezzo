import { describe, expect, it } from 'vitest';
import type { Segment } from './project.ts';
import { mergeWithNext, MIN_WORD_SECONDS, setWordText, setWordTiming, splitTime } from './transcript-edit.ts';

const w = (text: string, start: number, end: number, p = 0.5) => ({ text, start, end, p });
const seg = (...words: ReturnType<typeof w>[]): Segment => ({ start: words[0]!.start, end: words.at(-1)!.end, words });

/** Two sentences: "Dobroveče svima." | "Igrali futbal ski." */
const sample = (): Segment[] => [
  seg(w('Dobroveče', 1, 2), w('svima.', 2, 2.5)),
  seg(w('Igrali', 3, 3.4), w('futbal', 3.4, 3.8), w('ski.', 3.8, 4)),
];
const texts = (segments: Segment[]) => segments.map((s) => s.words.map((x) => x.text));

describe('setWordText', () => {
  it('replaces the text and marks the word certain', () => {
    const s = sample();
    expect(setWordText(s, { segment: 1, word: 1 }, 'fudbal')).toBe(1);
    expect(s[1]!.words[1]).toEqual(w('fudbal', 3.4, 3.8, 1));
  });

  it('splits at spaces and shares the time by length', () => {
    const s = sample();
    expect(setWordText(s, { segment: 0, word: 0 }, ' Dobro  veče ')).toBe(2);
    expect(s[0]!.words.slice(0, 2)).toEqual([w('Dobro', 1, 1.556, 1), w('veče', 1.556, 2, 1)]);
    expect(s[0]).toMatchObject({ start: 1, end: 2.5 });
  });

  it('writes Cyrillic as Latin', () => {
    const s = sample();
    setWordText(s, { segment: 0, word: 1 }, 'свима.');
    expect(s[0]!.words[1]!.text).toBe('svima.');
  });

  it('deletes the word when the text is empty, and an emptied segment with it', () => {
    const s = sample();
    expect(setWordText(s, { segment: 0, word: 0 }, '  ')).toBe(0);
    expect(s[0]).toMatchObject({ start: 2, end: 2.5 });
    setWordText(s, { segment: 0, word: 0 }, '');
    expect(texts(s)).toEqual([['Igrali', 'futbal', 'ski.']]);
  });

  it('leaves an unchanged word alone, confidence included', () => {
    const s = sample();
    setWordText(s, { segment: 1, word: 0 }, 'Igrali');
    expect(s[1]!.words[0]!.p).toBe(0.5);
  });
});

describe('splitTime', () => {
  it('keeps a word without length in one place', () => {
    expect(splitTime({ start: 2, end: 2 }, ['a', 'b'])).toEqual([{ start: 2, end: 2 }, { start: 2, end: 2 }]);
  });
});

describe('mergeWithNext', () => {
  it('joins two words into one spanning both', () => {
    const s = sample();
    expect(mergeWithNext(s, { segment: 1, word: 1 })).toBe(true);
    expect(s[1]!.words).toEqual([w('Igrali', 3, 3.4), w('futbalski.', 3.4, 4, 1)]);
  });

  it('pulls the next segment\'s first word across the break', () => {
    const s = sample();
    mergeWithNext(s, { segment: 0, word: 1 });
    expect(texts(s)).toEqual([['Dobroveče', 'svima.Igrali'], ['futbal', 'ski.']]);
    expect(s[0]!.end).toBe(3.4);
    expect(s[1]!.start).toBe(3.4);
  });

  it('does nothing at the last word', () => {
    expect(mergeWithNext(sample(), { segment: 1, word: 2 })).toBe(false);
  });
});

describe('setWordTiming', () => {
  it('moves a word inside the gap around it', () => {
    const s = sample();
    setWordTiming(s, { segment: 0, word: 1 }, 2.1, 2.7);
    expect(s[0]!.words[1]).toMatchObject({ start: 2.1, end: 2.7 });
    expect(s[0]!.end).toBe(2.7);
  });

  it('pushes the neighbours back where they touch', () => {
    const s = sample();
    setWordTiming(s, { segment: 1, word: 1 }, 3.3, 3.9);
    expect(s[1]!.words.map((x) => [x.start, x.end])).toEqual([[3, 3.3], [3.3, 3.9], [3.9, 4]]);
  });

  it('works across a segment break', () => {
    const s = sample();
    setWordTiming(s, { segment: 1, word: 0 }, 2.4, 3.4);
    expect(s[0]!.words[1]!.end).toBe(2.4);
    expect(s[0]!.end).toBe(2.4);
    expect(s[1]!.start).toBe(2.4);
  });

  it('never squeezes a neighbour below the minimum or swaps words', () => {
    const s = sample();
    setWordTiming(s, { segment: 1, word: 1 }, 2, 5);
    const [igrali, futbal, ski] = s[1]!.words;
    expect(futbal!.start).toBeCloseTo(igrali!.start + MIN_WORD_SECONDS);
    expect(futbal!.end).toBeCloseTo(ski!.end - MIN_WORD_SECONDS);
    expect(ski!.start).toBe(futbal!.end);
  });

  it('keeps a word at least the minimum long', () => {
    const s = sample();
    setWordTiming(s, { segment: 0, word: 0 }, 1.5, 1.2);
    expect(s[0]!.words[0]).toMatchObject({ start: 1.5, end: 1.54 });
  });
});
