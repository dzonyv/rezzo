import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BCS_LETTERS, FontFileError, missingLetters, readFont } from '../shared/font-file.ts';
import { BUNDLED_FONTS, fontChoices, hasFont } from '../shared/fonts.ts';

const FONTS_DIR = path.resolve('src/renderer/src/fonts');
const BASIC_LATIN = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i)).join('');
/** Quotes and dashes BCS text uses. */
const PUNCTUATION = '„“”‘’…–—';

describe('bundled fonts', () => {
  for (const font of BUNDLED_FONTS) {
    describe(font.family, () => {
      it('ships its license next to it', () => {
        const license = path.join(FONTS_DIR, font.folder, 'OFL.txt');
        expect(existsSync(license)).toBe(true);
        expect(readFileSync(license, 'utf8')).toContain('SIL Open Font License, Version 1.1');
      });

      for (const { weight, file } of font.files) {
        it(`${file} has every letter captions need`, () => {
          const info = readFont(readFileSync(path.join(FONTS_DIR, font.folder, file)));
          expect(info.family).toBe(font.family);
          if (Array.isArray(weight)) expect(info.variable).toBe(true);
          else expect(info.weight).toBe(weight);
          expect(missingLetters(info, BASIC_LATIN + BCS_LETTERS + PUNCTUATION)).toEqual([]);
        });
      }
    });
  }
});

describe('readFont', () => {
  it('refuses what is not a font', () => {
    expect(() => readFont(new TextEncoder().encode('just some text, not a font at all'))).toThrow(FontFileError);
  });

  it('refuses a cut-off font', () => {
    const bytes = readFileSync(path.join(FONTS_DIR, 'anton', 'Anton-Regular.ttf'));
    expect(() => readFont(bytes.subarray(0, 2000))).toThrow(FontFileError);
  });

  it('knows what a font lacks', () => {
    const info = readFont(readFileSync(path.join(FONTS_DIR, 'anton', 'Anton-Regular.ttf')));
    expect(info.has('A'.codePointAt(0)!)).toBe(true);
    // Anton has no Devanagari.
    expect(missingLetters(info, 'Aक')).toEqual(['क']);
  });
});

describe('font choices', () => {
  it('offers the bundled weights, then added fonts', () => {
    const custom = [{ family: 'Lobster', weight: 400, file: `${'a'.repeat(64)}.ttf` }];
    const choices = fontChoices(custom);
    expect(choices.map((c) => c.family)).toEqual(['Poppins', 'Montserrat', 'Anton', 'Lobster']);
    expect(choices[0]!.weights).toEqual([500, 600, 700, 800, 900]);
    expect(choices[1]!.weights).toContain(700);
  });

  it('knows which fonts are on this computer', () => {
    expect(hasFont({ family: 'Poppins', weight: 700 }, [])).toBe(true);
    expect(hasFont({ family: 'Poppins', weight: 300 }, [])).toBe(false);
    expect(hasFont({ family: 'Montserrat', weight: 650 }, [])).toBe(true);
    expect(hasFont({ family: 'Lobster', weight: 400 }, [])).toBe(false);
    expect(hasFont({ family: 'Lobster', weight: 400 }, [{ family: 'Lobster', weight: 400, file: `${'a'.repeat(64)}.ttf` }])).toBe(true);
  });
});
