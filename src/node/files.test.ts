import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { safeFileName, writeFileAtomic } from './files.ts';

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

describe('writing a file whole', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'rezzo-files-'));
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('copes with two writes to one file at the same time, and leaves one of them whole', async () => {
    const file = path.join(dir, 'result.json');
    const a = 'a'.repeat(100_000);
    const b = 'b'.repeat(100_000);
    for (let i = 0; i < 20; i++) await Promise.all([writeFileAtomic(file, a), writeFileAtomic(file, b)]);
    expect([a, b]).toContain(await readFile(file, 'utf8'));
    expect(await readdir(dir)).toEqual(['result.json']);
  });

  it('copes with the file being read while it is replaced', async () => {
    const file = path.join(dir, 'result.json');
    await writeFileAtomic(file, 'x'.repeat(1_000_000));
    for (let i = 0; i < 30; i++) await Promise.all([readFile(file), writeFileAtomic(file, 'y'.repeat(1_000_000))]);
    expect((await readFile(file, 'utf8')).length).toBe(1_000_000);
  });
});
