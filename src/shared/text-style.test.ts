import { describe, expect, it } from 'vitest';
import { textLines, textName } from './text-style.ts';

describe('text layer lines', () => {
  it('colours the words between asterisks', () => {
    expect(textLines('ON JE *LAGAO*', false)).toEqual([[{ text: 'ON JE ', accent: false }, { text: 'LAGAO', accent: true }]]);
  });

  it('carries a marked stretch over to the next line', () => {
    expect(textLines('prvi *drugi\ntreći* četvrti', false)).toEqual([
      [{ text: 'prvi ', accent: false }, { text: 'drugi', accent: true }],
      [{ text: 'treći', accent: true }, { text: ' četvrti', accent: false }],
    ]);
  });

  it('keeps an empty line, and two asterisks as one', () => {
    expect(textLines('a\n\n5**2', false)).toEqual([[{ text: 'a', accent: false }], [], [{ text: '5*2', accent: false }]]);
  });

  it('puts every letter in capitals, ours included', () => {
    expect(textLines('čćžšđ dž lj nj', true)[0]![0]!.text).toBe('ČĆŽŠĐ DŽ LJ NJ');
  });

  it('names a layer by its text on one line, without asterisks', () => {
    expect(textName('  Šta se *desilo*\nposle utakmice?  ')).toBe('Šta se desilo posle utakmice?');
    expect(textName('**')).toBe('*');
    expect(textName('')).toBe('');
  });
});
