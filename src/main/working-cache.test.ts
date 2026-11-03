import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analysisFileOf } from '../shared/analysis.ts';
import { workingFileName } from '../shared/working.ts';
import { prune } from './working-cache.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-work-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('prune', () => {
  it('keeps the newest working files, and takes the analysis of the others with them', async () => {
    const names = [0, 1, 2].map((i) => workingFileName({ first: i * 100, end: i * 100 + 50, rate: [30, 1] }));
    for (const [i, name] of names.entries()) {
      const file = path.join(dir, name);
      await writeFile(file, 'mp4');
      await writeFile(analysisFileOf(file), '{}');
      const at = new Date(Date.now() - (3 - i) * 60_000);
      await utimes(file, at, at);
    }
    await prune(dir, 1, 2);
    expect((await readdir(dir)).sort()).toEqual([names[1], path.basename(analysisFileOf(names[1]!)), names[2], path.basename(analysisFileOf(names[2]!))].sort());
  });
});
