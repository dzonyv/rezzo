import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dropOtherLanguages } from './transcribe.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-transcribe-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('dropOtherLanguages', () => {
  it('removes transcripts cached as hr or bs and keeps the rest of the cache', async () => {
    const files = ['transcript-sr-m.json', 'transcript-hr-m.json', 'transcript-bs-m.json', 'transcript-hr-other.json', 'audio.wav'];
    for (const f of files) await writeFile(path.join(dir, f), '{}');
    await dropOtherLanguages(dir, 'sr', 'm');
    expect((await readdir(dir)).sort()).toEqual(['audio.wav', 'transcript-hr-other.json', 'transcript-sr-m.json']);
  });

  it('does nothing in a folder that has none', async () => {
    await expect(dropOtherLanguages(path.join(dir, 'missing'), 'sr', 'm')).resolves.toBeUndefined();
  });
});
