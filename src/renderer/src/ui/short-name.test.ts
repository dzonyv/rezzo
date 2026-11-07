import { describe, expect, it } from 'vitest';
import { shortName } from './short-name.ts';

describe('shortName', () => {
  it('uses the number in the name', () => {
    expect(shortName('Razgovor 47')).toBe('47');
    expect(shortName('Ep. 3, part 2')).toBe('2');
  });

  it('uses the first letters of two words otherwise', () => {
    expect(shortName('Specijal iz Mostara')).toBe('SI');
    expect(shortName('đorđe šantić')).toBe('ĐŠ');
  });

  it('copes with one word, long numbers and nothing at all', () => {
    expect(shortName('Intervju')).toBe('IN');
    expect(shortName('Podkast 2024')).toBe('PO');
    expect(shortName('20240611')).toBe('611');
    expect(shortName('')).toBe('·');
  });
});
