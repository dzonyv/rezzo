import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeTable } from '../shared/ekavian.ts';

/** The list that ships, made by scripts/make-ekavian.mts. */
const shipped = decodeTable(readFileSync('src/renderer/src/ekavian/words.txt', 'utf8'));

describe('ekavian word list', () => {
  it('has the words of the reported transcript', () => {
    expect(shipped.get('gdje')).toBe('gde');
    expect(shipped.get('prosvjetu')).toBe('prosvetu');
    expect(shipped.get('vještine')).toBe('veštine');
  });

  it('has the forms of common words, and leaves alone the ones that are words in ekavian too', () => {
    const pairs = {
      vještine: 'veštine', vještinom: 'veštinom', vrijeme: 'vreme', dijete: 'dete', djeca: 'deca', riječi: 'reči',
      svijet: 'svet', čovjek: 'čovek', uvijek: 'uvek', dvije: 'dve', poslije: 'posle', prije: 'pre', mjesto: 'mesto',
      vidio: 'video', htjela: 'htela', razumijem: 'razumem', volio: 'voleo', željela: 'želela', dio: 'deo',
      lijepo: 'lepo', ljeto: 'leto', nježno: 'nežno', cijena: 'cena', mlijeko: 'mleko', njemački: 'nemački',
    };
    for (const [from, to] of Object.entries(pairs)) expect(shipped.get(from), from).toBe(to);
    for (const same of ['njega', 'njemu', 'njem', 'njego', 'znanje', 'polje', 'bolje', 'vremena', 'smijem', 'baljević']) {
      expect(shipped.has(same), same).toBe(false);
    }
  });

});
