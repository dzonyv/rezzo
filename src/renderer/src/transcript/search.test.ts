import { describe, expect, it } from 'vitest';
import { buildIndex, fold, search } from './search.ts';
import { flatten, wordAt } from './words.ts';

const words = (text: string) => text.split(' ').map((t, i) => ({ text: t, start: i, end: i + 0.5, p: 1 }));

describe('fold', () => {
  it('drops case, diacritics and punctuation', () => {
    expect(fold('Čaša,')).toBe('casa');
    expect(fold('„Ćuprija“!')).toBe('cuprija');
    expect(fold('ŽIVOT')).toBe('zivot');
  });

  it('writes đ two ways', () => {
    expect(fold('Đoković', 0)).toBe('djokovic');
    expect(fold('Đoković', 1)).toBe('dokovic');
  });

  it('keeps digits', () => {
    expect(fold('35.')).toBe('35');
  });
});

describe('search', () => {
  const ws = words('Nikad u životu nisam vidio, Đoković kaže: „Čudo!” Zola šutira 20 metara.');
  const index = buildIndex(ws);
  const texts = (q: string) => search(index, q).map((m) => ws.slice(m.first, m.last + 1).map((w) => w.text).join(' '));

  it('finds words regardless of case and diacritics', () => {
    expect(texts('zivotu')).toEqual(['životu']);
    expect(texts('CUDO')).toEqual(['„Čudo!”']);
  });

  it('finds đ typed as dj or d', () => {
    expect(texts('djokovic')).toEqual(['Đoković']);
    expect(texts('dokovic')).toEqual(['Đoković']);
    expect(texts('Đoković')).toEqual(['Đoković']);
  });

  it('matches phrases across punctuation', () => {
    expect(texts('vidio djokovic')).toEqual(['vidio, Đoković']);
    expect(texts('kaze cudo')).toEqual(['kaže: „Čudo!”']);
  });

  it('matches inside words', () => {
    expect(texts('sutir')).toEqual(['šutira']);
  });

  it('finds every occurrence, in order', () => {
    const ix = buildIndex(words('da li da ne da'));
    expect(search(ix, 'da').map((m) => m.first)).toEqual([0, 2, 4]);
  });

  it('ignores an empty query', () => {
    expect(search(index, '  ,. ')).toEqual([]);
  });
});

describe('wordAt', () => {
  const { words: flat } = flatten([
    { start: 1, end: 2, words: [{ text: 'a', start: 1, end: 1.5, p: 1 }, { text: 'b', start: 1.6, end: 2, p: 1 }] },
    { start: 5, end: 6, words: [{ text: 'c', start: 5, end: 6, p: 1 }] },
  ]);

  it('finds the word being spoken', () => {
    expect(wordAt(flat, 0.5)).toBe(-1);
    expect(wordAt(flat, 1)).toBe(0);
    expect(wordAt(flat, 1.7)).toBe(1);
    expect(wordAt(flat, 3)).toBe(1);
    expect(wordAt(flat, 9)).toBe(2);
  });

  it('numbers words across segments', () => {
    expect(flat.map((w) => [w.index, w.segment])).toEqual([[0, 0], [1, 0], [2, 1]]);
  });
});
