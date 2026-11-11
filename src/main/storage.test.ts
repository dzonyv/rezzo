/**
 * Measuring and clearing the cache and downloaded tools, on a real folder
 * in the temp directory. Recent projects and the worker's running jobs are
 * made up.
 */
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecentProject } from '../shared/api.ts';

let root = '';
let recent: RecentProject[] = [];
let busy: string[] = [];

/** Set to make the next delete fail as Windows does for a file still open somewhere. */
let locked = false;
vi.mock('node:fs/promises', async (original) => {
  const fsp = await original<typeof import('node:fs/promises')>();
  return {
    ...fsp,
    rm: (...args: Parameters<typeof fsp.rm>) => {
      if (!locked) return fsp.rm(...args);
      locked = false;
      return Promise.reject(Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }));
    },
  };
});
vi.mock('electron', () => ({ shell: { openPath: async () => '' } }));
vi.mock('./paths.ts', () => ({ localDataDir: () => root, cacheDir: () => path.join(root, 'cache') }));
vi.mock('./project-files.ts', () => ({ recentProjects: async () => recent }));
vi.mock('./worker-host.ts', () => ({
  inUse: (dir: string) => busy.some((f) => !path.relative(dir, f).startsWith('..')),
  holding: <T>(_dir: string, work: () => Promise<T>) => work(),
}));

const { clearStorage, storageUsage } = await import('./storage.ts');

const fp = (digit: string) => digit.repeat(64);

/** A file of `bytes` bytes at `parts` under the root. */
async function file(bytes: number, ...parts: string[]): Promise<void> {
  const at = path.join(root, ...parts);
  await mkdir(path.dirname(at), { recursive: true });
  await writeFile(at, Buffer.alloc(bytes));
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'rezzo-storage-'));
  recent = [];
  busy = [];
});

afterEach(() => rm(root, { recursive: true, force: true }));

describe('storageUsage', () => {
  it('measures each video’s folder and names it after the recent project it belongs to', async () => {
    await file(300, 'cache', fp('a'), 'work', 'clip.mp4');
    await file(200, 'cache', fp('a'), 'thumbnails', '1000.jpg');
    await file(50, 'cache', fp('b'), 'overlay', 'logo.mp4');
    await file(400, 'cache', fp('c'), 'preview-480p.mp4');
    // Not the app's: left out.
    await file(10, 'cache', 'notes', 'x.txt');
    const project = path.join(root, 'ep.rezzo');
    await writeFile(project, JSON.stringify({ source: { fingerprint: fp('a') }, assets: [{ fingerprint: fp('b'), name: 'logo.mov' }] }));
    recent = [{ path: project, name: 'Episode 12', openedAt: '2026-11-01T10:00:00.000Z' }];

    const { cache } = await storageUsage();
    expect(cache).toEqual([
      { fingerprint: fp('a'), kind: 'episode', name: 'Episode 12', openedAt: '2026-11-01T10:00:00.000Z', bytes: 500, busy: false },
      { fingerprint: fp('c'), kind: 'other', name: null, openedAt: null, bytes: 400, busy: false },
      { fingerprint: fp('b'), kind: 'layer', name: 'logo.mov', openedAt: null, bytes: 50, busy: false },
    ]);
  });

  it('lists the downloaded tools, and ones this version no longer uses', async () => {
    await file(900, 'tools', 'old-model', 'model.bin');
    const { tools } = await storageUsage();
    expect(tools).toEqual([{ id: 'old-model', name: 'old-model', known: false, bytes: 900, busy: false }]);
  });

  it('marks a folder a running job works in', async () => {
    await file(10, 'cache', fp('a'), 'work', 'clip.mp4');
    busy = ['h264', path.join(root, 'cache', fp('a'), 'work', 'clip.mp4')];
    expect((await storageUsage()).cache[0]!.busy).toBe(true);
  });
});

describe('clearStorage', () => {
  it('deletes the folders asked for and leaves the rest', async () => {
    await file(10, 'cache', fp('a'), 'work', 'clip.mp4');
    await file(10, 'cache', fp('b'), 'work', 'clip.mp4');
    await file(10, 'tools', 'old-model', 'model.bin');
    const { usage, skipped } = await clearStorage({ cache: [fp('a')], tools: ['old-model'] });
    expect(skipped).toBe(0);
    expect(await readdir(path.join(root, 'cache'))).toEqual([fp('b')]);
    expect(await readdir(path.join(root, 'tools'))).toEqual([]);
    expect(usage.cache.map((c) => c.fingerprint)).toEqual([fp('b')]);
  });

  it('leaves a folder a running job works in, and says so', async () => {
    await file(10, 'cache', fp('a'), 'work', 'clip.mp4');
    busy = [path.join(root, 'cache', fp('a'))];
    const { skipped } = await clearStorage({ cache: [fp('a')], tools: [] });
    expect(skipped).toBe(1);
    expect(await readdir(path.join(root, 'cache'))).toEqual([fp('a')]);
  });

  it("counts a folder Windows won't delete as left, and clears the rest", async () => {
    await file(10, 'cache', fp('a'), 'work', 'clip.mp4');
    await file(10, 'cache', fp('b'), 'work', 'clip.mp4');
    locked = true;
    const { skipped } = await clearStorage({ cache: [fp('a'), fp('b')], tools: [] });
    expect(skipped).toBe(1);
    expect(await readdir(path.join(root, 'cache'))).toHaveLength(1);
  });

  it('takes only folder names, never a path out of its folder', async () => {
    await expect(clearStorage({ cache: ['..'], tools: [] })).rejects.toThrow();
    await expect(clearStorage({ cache: [], tools: ['..'] })).rejects.toThrow();
    await expect(clearStorage({ cache: [], tools: ['../cache'] })).rejects.toThrow();
  });
});
