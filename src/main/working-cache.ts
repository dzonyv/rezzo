/**
 * Folders of cached working files, named by shared/working.ts: finding one
 * that covers a range, and deleting the oldest when there are too many.
 */
import { readdir, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import type { FrameRate } from '../shared/frames.ts';
import { analysisFileOf } from '../shared/analysis.ts';
import { parseWorkingFileName, spanCovers, type WorkingSpan } from '../shared/working.ts';

export interface CachedFile {
  file: string;
  span: WorkingSpan;
}

/** The working files of this version in `dir`; others (older versions, part files) are ignored. */
export async function cachedSpans(dir: string, version: number): Promise<CachedFile[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const span = parseWorkingFileName(name, version);
    return span ? [{ file: path.join(dir, name), span }] : [];
  });
}

/** A cached file at `rate` holding all of `range`, marked as just used so pruning keeps it. */
export async function findCovering(dir: string, version: number, rate: FrameRate, range: { start: number; end: number }): Promise<CachedFile | null> {
  const found = (await cachedSpans(dir, version)).find(({ span }) => span.rate.join() === rate.join() && spanCovers(span, range));
  if (!found) return null;
  const now = new Date();
  // Gone since the listing (a prune elsewhere): as good as not there.
  return (await utimes(found.file, now, now).then(() => true, () => false)) ? found : null;
}

/**
 * Keeps the `keep` most recently used files in `dir`. Another prune of the
 * same folder may delete files under it; those are simply skipped.
 */
export async function prune(dir: string, version: number, keep: number): Promise<void> {
  const files = await cachedSpans(dir, version);
  const dated = (await Promise.all(files.map(async ({ file }) => ({ file, at: (await stat(file).catch(() => null))?.mtimeMs })))).filter(
    (d): d is { file: string; at: number } => d.at !== undefined,
  );
  dated.sort((a, b) => b.at - a.at);
  // The clip analysis made from a working file goes with it.
  await Promise.all(dated.slice(keep).flatMap(({ file }) => [rm(file, { force: true }), rm(analysisFileOf(file), { force: true })]));
}
