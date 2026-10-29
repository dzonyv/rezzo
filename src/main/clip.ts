/**
 * Working files for clips: converted once per stretch of the source and
 * kept in the cache, next to the source's other cached files.
 */
import type { WebContents } from 'electron';
import { readdir, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { PrepareResult } from '../shared/api.ts';
import { workingFrameRate } from '../shared/frames.ts';
import { MAX_CLIP_SECONDS, sourceSchema } from '../shared/project.ts';
import { parseWorkingFileName, spanCovers, spanEnd, spanStart, workingFileName, workingSpan, type WorkingSpan } from '../shared/working.ts';
import { allowMedia, sourceUrl } from './media-protocol.ts';
import { cacheDir } from './paths.ts';
import { callWorker } from './worker-host.ts';

/** Working files kept per source; older ones are deleted. */
const KEEP = 20;

const rangeSchema = z
  .object({ start: z.number().finite().nonnegative(), end: z.number().finite() })
  .refine((r) => r.end > r.start && r.end - r.start <= MAX_CLIP_SECONDS + 1e-6);

/** One preparation per window: a newer request (another clip, a new range) replaces the old one. */
const running = new Map<number, AbortController>();

async function cachedSpans(dir: string): Promise<{ file: string; span: WorkingSpan }[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const span = parseWorkingFileName(name);
    return span ? [{ file: path.join(dir, name), span }] : [];
  });
}

async function prune(dir: string): Promise<void> {
  const files = await cachedSpans(dir);
  const dated = await Promise.all(files.map(async ({ file }) => ({ file, at: (await stat(file)).mtimeMs })));
  dated.sort((a, b) => b.at - a.at);
  await Promise.all(dated.slice(KEEP).map(({ file }) => rm(file, { force: true })));
}

export async function prepareClip(sender: WebContents, sourceArg: unknown, rangeArg: unknown): Promise<PrepareResult> {
  const source = sourceSchema.parse(sourceArg);
  const range = rangeSchema.parse(rangeArg);
  sourceUrl(source.path); // the same check as playing it: only a source we know
  const rate = workingFrameRate(source);
  const dir = path.join(cacheDir(), source.fingerprint, 'work');

  const ready = (file: string, span: WorkingSpan): PrepareResult => ({
    ok: true,
    url: allowMedia(file),
    start: spanStart(span),
    end: spanEnd(span),
    frameRate: span.rate,
  });

  // A file made for this clip before it was trimmed, or for an overlapping clip.
  const cached = (await cachedSpans(dir)).find(({ span }) => span.rate.join() === rate.join() && spanCovers(span, range));
  if (cached) {
    const now = new Date();
    await utimes(cached.file, now, now); // keeps it from being pruned
    return ready(cached.file, cached.span);
  }

  running.get(sender.id)?.abort();
  const abort = new AbortController();
  running.set(sender.id, abort);
  const span = workingSpan(range, source, rate);
  const out = path.join(dir, workingFileName(span));
  try {
    await callWorker(
      'makeWorkingFile',
      [{
        sourcePath: source.path,
        start: spanStart(span),
        duration: spanEnd(span) - spanStart(span),
        frameRate: rate,
        colorSpace: source.video.colorSpace,
        height: source.video.height,
        out,
      }],
      {
        signal: abort.signal,
        onProgress: (fraction) => {
          if (!sender.isDestroyed()) sender.send('clip:prepare-progress', { fraction: fraction as number });
        },
      },
    );
  } catch (e) {
    if (abort.signal.aborted) return { ok: false, error: 'cancelled' };
    return { ok: false, error: 'failed', detail: e instanceof Error ? e.message : String(e) };
  } finally {
    if (running.get(sender.id) === abort) running.delete(sender.id);
  }
  await prune(dir);
  return ready(out, span);
}
