import { describe, expect, it } from 'vitest';
import { safeFileName } from './files.ts';

describe('file names from user text', () => {
  it('keeps letters with diacritics and spaces', () => {
    expect(safeFileName('Đorđe o fudbalu, čašama i žurci', 'mp4', 'klip')).toBe('Đorđe o fudbalu, čašama i žurci.mp4');
  });

  it('replaces characters Windows refuses', () => {
    expect(safeFileName('Da li je "to" 1/2: da?', 'mp4', 'klip')).toBe('Da li je _to_ 1_2_ da_.mp4');
    expect(safeFileName('red\nnovi', 'mp4', 'klip')).toBe('red_novi.mp4');
  });

  it('drops trailing dots and spaces, and falls back when nothing is left', () => {
    expect(safeFileName('Pa dobro… ', 'rezzo', 'project')).toBe('Pa dobro….rezzo');
    expect(safeFileName('Kraj...', 'mp4', 'klip')).toBe('Kraj.mp4');
    expect(safeFileName('  ', 'mp4', 'klip')).toBe('klip.mp4');
  });
});
