import { describe, expect, it } from 'vitest';
import type { Segment } from './project.ts';
import { applyReplacements, replaceWord, ruleFor, type Replacement } from './replacements.ts';

const rules: Replacement[] = [
  { from: 'futbal*', to: 'fudbal*' },
  { from: 'dobroveče', to: 'dobro veče' },
  { from: 'eee', to: '' },
  { from: 'Đoković', to: 'Novak Đoković' },
];

describe('replaceWord', () => {
  it('matches whole words, ignoring case and punctuation', () => {
    expect(replaceWord('Futbal,', rules)).toBe('Fudbal,');
    expect(replaceWord('„futbal“', rules)).toBe('„fudbal“');
    expect(replaceWord('FUTBAL!', rules)).toBe('FUDBAL!');
    expect(replaceWord('đoković', rules)).toBe('Novak Đoković');
  });

  it('keeps the ending after a prefix rule, as written', () => {
    expect(replaceWord('futbalski.', rules)).toBe('fudbalski.');
    expect(replaceWord('FUTBALA', rules)).toBe('FUDBALA');
  });

  it('tells diacritics apart', () => {
    expect(replaceWord('Dokovic', rules)).toBeNull();
    expect(replaceWord('fudbal', rules)).toBeNull();
  });

  it('only matches the start of a word with a prefix rule, the whole word without one', () => {
    expect(replaceWord('nefutbal', rules)).toBeNull();
    expect(replaceWord('dobrovečer', rules)).toBeNull();
  });

  it('reads Cyrillic rules and words as Latin', () => {
    expect(replaceWord('Футбал', rules)).toBe('Fudbal');
    expect(replaceWord('futbal', [{ from: 'футбал', to: 'фудбал' }])).toBe('fudbal');
  });

  it('deletes a word replaced by nothing, punctuation and all', () => {
    expect(replaceWord('Eee,', rules)).toBe('');
  });

  it('leaves punctuation-only words alone', () => {
    expect(replaceWord('–', rules)).toBeNull();
  });
});

describe('applyReplacements', () => {
  it('fixes the whole transcript in one pass and counts the words', () => {
    const segments: Segment[] = [
      { start: 0, end: 2, words: [{ text: 'Dobroveče,', start: 0, end: 1, p: 0.9 }, { text: 'eee', start: 1, end: 2, p: 0.9 }] },
      { start: 3, end: 4, words: [{ text: 'futbal.', start: 3, end: 4, p: 0.3 }] },
      { start: 5, end: 6, words: [{ text: 'eee', start: 5, end: 6, p: 0.9 }] },
    ];
    expect(applyReplacements(segments, rules)).toBe(4);
    expect(segments.map((s) => s.words.map((w) => w.text))).toEqual([['Dobro', 'veče,'], ['fudbal.']]);
    expect(segments[0]!.words[1]).toMatchObject({ start: 0.5, end: 1 });
    expect(segments[1]!.words[0]).toMatchObject({ start: 3, end: 4, p: 1 });
  });
});

describe('ruleFor', () => {
  it('learns the word without its punctuation and the capital of a sentence start', () => {
    expect(ruleFor('Futbal,', 'Fudbal,')).toEqual({ from: 'futbal', to: 'fudbal' });
    expect(ruleFor('dokovic', 'Đoković')).toEqual({ from: 'dokovic', to: 'Đoković' });
    expect(ruleFor('dobroveče.', 'dobro veče.')).toEqual({ from: 'dobroveče', to: 'dobro veče' });
  });

  it('has nothing to learn from a deletion or a change of case', () => {
    expect(ruleFor('eee', '')).toBeNull();
    expect(ruleFor('futbal', 'Futbal')).toBeNull();
  });
});
