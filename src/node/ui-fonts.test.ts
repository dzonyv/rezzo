import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BCS_LETTERS, missingLetters, readFont } from '../shared/font-file.ts';

/** The fonts of the interface itself, as fonts.css loads them. */
const DIR = path.resolve('src/renderer/src/ui/fonts');
const css = readFileSync(path.join(DIR, 'fonts.css'), 'utf8');
const files = [...css.matchAll(/url\('\.\/([^']+)'\)/g)].map((m) => m[1]!);
const BASIC_LATIN = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i)).join('');
/** Quotes and dashes the BCS interface text uses. */
const PUNCTUATION = '„“”‘’…–—';

describe('interface fonts', () => {
  it('loads at least one font', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} has every letter the interface needs`, () => {
      const info = readFont(readFileSync(path.join(DIR, file)));
      expect(missingLetters(info, BASIC_LATIN + BCS_LETTERS + PUNCTUATION)).toEqual([]);
    });
  }

  for (const folder of readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    it(`${folder.name} ships its license next to it`, () => {
      const license = path.join(DIR, folder.name, 'OFL.txt');
      expect(existsSync(license)).toBe(true);
      expect(readFileSync(license, 'utf8')).toContain('SIL Open Font License, Version 1.1');
    });
  }
});
