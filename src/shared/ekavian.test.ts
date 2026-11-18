import { describe, expect, it } from 'vitest';
import { decodeTable, ekavianOf, encodeTable, writeSpeech } from './ekavian.ts';
import type { Segment } from './project.ts';

const table = new Map([
  ['gdje', 'gde'],
  ['vještine', 'veštine'],
]);

const segment = (...texts: string[]): Segment => ({
  start: 0,
  end: texts.length,
  words: texts.map((text, i) => ({ text, start: i, end: i + 1, p: 0.9 })),
});

describe('ekavian', () => {
  it('writes the table so it reads back the same', () => {
    const table = new Map([
      ['gdje', 'gde'],
      ['gdjegod', 'gdegod'],
      ['vještine', 'veštine'],
      ['a'.repeat(40) + 'je', 'a'.repeat(40) + 'e'],
    ]);
    const text = encodeTable(table);
    expect(text).toContain('\n0gdje 2e\n4god 2egod\n');
    expect(decodeTable(text)).toEqual(table);
    // Git may check it out with CRLF.
    expect(decodeTable(text.replace(/\n/g, '\r\n'))).toEqual(table);
  });

  it('turns a word, keeping its punctuation and capitals', () => {
    expect(ekavianOf('gdje', table)).toBe('gde');
    expect(ekavianOf('Gdje,', table)).toBe('Gde,');
    expect(ekavianOf('„VJEŠTINE”', table)).toBe('„VEŠTINE”');
    expect(ekavianOf('gde', table)).toBeNull();
  });

  it('turns words ekavian and back, remembering how Whisper wrote them', () => {
    const segments = [segment('Gdje', 'su', 'vještine?')];
    expect(writeSpeech(segments, () => true, table)).toBe(2);
    expect(segments[0]!.words.map((w) => w.text)).toEqual(['Gde', 'su', 'veštine?']);
    expect(segments[0]!.words[0]!.spoken).toBe('Gdje');
    expect(writeSpeech(segments, () => true, table)).toBe(0);
    expect(writeSpeech(segments, () => false, table)).toBe(2);
    expect(segments[0]!.words.map((w) => w.text)).toEqual(['Gdje', 'su', 'vještine?']);
    expect(segments[0]!.words.some((w) => 'spoken' in w)).toBe(false);
  });

  it('goes word by word, and never touches a word the user typed', () => {
    const segments = [segment('gdje', 'gdje', 'gdje')];
    segments[0]!.words[2]!.p = 1;
    writeSpeech(segments, (w) => w.start === 0 || w.start === 2, table);
    expect(segments[0]!.words.map((w) => w.text)).toEqual(['gde', 'gdje', 'gdje']);
  });
});
