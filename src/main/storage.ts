/**
 * What Rezzo keeps on the disk that it can make again, and clearing it:
 * the cache (a folder per video: working files, the episode preview,
 * thumbnails, clip analysis, the voices found, transcription leftovers)
 * and the tools and models it downloaded. Projects and their transcripts
 * aren't here. Whatever is cleared is made again when it's next needed.
 *
 * Nothing a running job uses is cleared: a folder is left alone while the
 * media worker works with a file in it (busyPaths), and a file Windows
 * won't delete (still open somewhere) stays, the rest of its folder going.
 */
import { shell } from 'electron';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { CachedFolder, DownloadedTool, StorageClear, StorageUsage } from '../shared/api.ts';
import { TOOLS } from '../node/tools/manifest.ts';
import { cacheDir, localDataDir } from './paths.ts';
import { recentProjects } from './project-files.ts';
import { busyPaths } from './worker-host.ts';

const FINGERPRINT = /^[0-9a-f]{64}$/;
const toolsDir = (): string => path.join(localDataDir(), 'tools');

/** Bytes in every file under `dir`; 0 when it isn't there. */
async function sizeOf(dir: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch {
    return 0;
  }
  const sizes = await Promise.all(
    entries.filter((e) => e.isFile()).map((e) => stat(path.join(e.parentPath, e.name)).then((s) => s.size, () => 0)),
  );
  return sizes.reduce((a, b) => a + b, 0);
}

/** Folders directly in `dir`. */
async function foldersIn(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Whether a running job was handed a path inside `dir` (Windows paths: case doesn't matter). */
function isBusy(dir: string, busy: readonly string[]): boolean {
  const base = path.resolve(dir).toLowerCase();
  return busy.some((p) => {
    if (!path.isAbsolute(p)) return false;
    const rel = path.relative(base, path.resolve(p).toLowerCase());
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

/** Only the parts of a project file that say which videos it uses. */
const namesSchema = z.object({
  source: z.object({ fingerprint: z.string() }).nullable().optional(),
  assets: z.array(z.object({ fingerprint: z.string(), name: z.string() })).optional(),
});

/** What the recent projects say each fingerprint is. The first (most recently opened) project to name one wins. */
async function namesByFingerprint(): Promise<Map<string, Pick<CachedFolder, 'kind' | 'name' | 'openedAt'>>> {
  const names = new Map<string, Pick<CachedFolder, 'kind' | 'name' | 'openedAt'>>();
  for (const recent of await recentProjects()) {
    let project: z.infer<typeof namesSchema>;
    try {
      project = namesSchema.parse(JSON.parse(await readFile(recent.path, 'utf8')));
    } catch {
      continue; // moved or damaged: its videos count as "other"
    }
    const source = project.source?.fingerprint;
    if (source && !names.has(source)) names.set(source, { kind: 'episode', name: recent.name, openedAt: recent.openedAt });
    for (const asset of project.assets ?? []) {
      if (!names.has(asset.fingerprint)) names.set(asset.fingerprint, { kind: 'layer', name: asset.name, openedAt: null });
    }
  }
  return names;
}

export async function storageUsage(): Promise<StorageUsage> {
  const busy = busyPaths();
  const [names, cacheFolders, toolFolders] = await Promise.all([namesByFingerprint(), foldersIn(cacheDir()), foldersIn(toolsDir())]);
  const cache = await Promise.all(
    cacheFolders
      .filter((f) => FINGERPRINT.test(f))
      .map(async (fingerprint): Promise<CachedFolder> => {
        const dir = path.join(cacheDir(), fingerprint);
        const known = names.get(fingerprint) ?? { kind: 'other' as const, name: null, openedAt: null };
        return { fingerprint, ...known, bytes: await sizeOf(dir), busy: isBusy(dir, busy) };
      }),
  );
  const tools = await Promise.all(
    toolFolders.map(async (id): Promise<DownloadedTool> => {
      const dir = path.join(toolsDir(), id);
      const tool = TOOLS.find((t) => t.id === id && t.kind === 'download');
      return { id, name: tool?.name ?? id, known: tool !== undefined, bytes: await sizeOf(dir), busy: isBusy(dir, busy) };
    }),
  );
  return {
    folder: localDataDir(),
    cache: cache.filter((c) => c.bytes > 0).sort((a, b) => b.bytes - a.bytes),
    tools: tools.filter((t) => t.bytes > 0).sort((a, b) => b.bytes - a.bytes),
  };
}

const clearSchema = z.object({
  cache: z.array(z.string().regex(FINGERPRINT)),
  // A folder's own name, never a path.
  tools: z.array(z.string().regex(/^[\w.-]+$/).refine((id) => id !== '.' && id !== '..')),
});

/** Deletes `dir` unless a running job uses it; false when it, or a file in it, stayed. */
async function clear(dir: string): Promise<boolean> {
  if (isBusy(dir, busyPaths())) return false;
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    return true;
  } catch {
    // A file still open somewhere stays; whatever went before it is gone.
    return false;
  }
}

export async function clearStorage(what: unknown): Promise<{ usage: StorageUsage; skipped: number }> {
  const { cache, tools }: StorageClear = clearSchema.parse(what);
  const results = await Promise.all([
    ...cache.map((f) => clear(path.join(cacheDir(), f))),
    ...tools.map((id) => clear(path.join(toolsDir(), id))),
  ]);
  return { usage: await storageUsage(), skipped: results.filter((ok) => !ok).length };
}

export async function revealStorage(): Promise<void> {
  await shell.openPath(localDataDir());
}
