import { describe, expect, it } from 'vitest';
import { toLatin } from './transliterate.ts';

describe('toLatin', () => {
  it('maps every letter of the alphabet', () => {
    expect(toLatin('абвгдђежзијклљмнњопрстћуфхцчџш')).toBe('abvgdđežzijklljmnnjoprstćufhcčdžš');
    expect(toLatin('АБВГДЂЕЖЗИЈКЛМНОПРСТЋУФХЦЧШ')).toBe('ABVGDĐEŽZIJKLMNOPRSTĆUFHCČŠ');
  });

  it('writes digraphs in title case at the start of a word', () => {
    expect(toLatin('Љубав')).toBe('Ljubav');
    expect(toLatin('Њива')).toBe('Njiva');
    expect(toLatin('Џеп')).toBe('Džep');
  });

  it('writes digraphs in all caps inside all-caps words', () => {
    expect(toLatin('ЉУБАВ')).toBe('LJUBAV');
    expect(toLatin('КОЊ')).toBe('KONJ');
    expect(toLatin('ЏЕП!')).toBe('DŽEP!');
  });

  it('writes a lone uppercase digraph letter in title case', () => {
    expect(toLatin('Љ')).toBe('Lj');
    expect(toLatin('слово Џ.')).toBe('slovo Dž.');
  });

  it('leaves Latin, digits and punctuation alone', () => {
    expect(toLatin('Ćao, šta ima? 2 puta.')).toBe('Ćao, šta ima? 2 puta.');
    expect(toLatin('Он је рекао: "OK, 100%".')).toBe('On je rekao: "OK, 100%".');
  });

  it('normalizes decomposed diacritics to single characters', () => {
    const decomposed = 'čevapi';
    expect(toLatin(decomposed)).toBe('čevapi');
    expect(toLatin(decomposed)).toHaveLength(6);
  });
});
