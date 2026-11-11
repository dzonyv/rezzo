/**
 * Working files for clips: converted once per stretch of the source and
 * kept in the cache, next to the source's other cached files.
 */
import type { WebContents } from 'electron';
import path from 'node:path';
import { z } from 'zod';
import type { PrepareResult } from '../shared/api.ts';
import { workingFrameRate } from '../shared/frames.ts';
import { MAX_CLIP_SECONDS, sourceSchema, type Source } from '../shared/project.ts';
import { spanEnd, spanStart, withinFrames, WORKING_VERSION, workingFileName, workingSpan, type WorkingSpan } from '../shared/working.ts';
import { allowMedia, sourceUrl } from './media-protocol.ts';
import { cacheDir } from './paths.ts';
import { callWorker } from './worker-host.ts';
import { findCovering, prune } from './working-cache.ts';

/** Working files kept per source; older ones are deleted. */
const KEEP = 20;

const rangeSchema = z
  .object({ start: z.number().finite().nonnegative(), end: z.number().finite() })
  .refine((r) => r.end > r.start && r.end - r.start <= MAX_CLIP_SECONDS + 1e-6);

/** One preparation per window: a newer request (another clip, a new range) replaces the old one. */
const running = new Map<number, AbortController>();

/** A working file from the cache that holds `range` of the source, or null when there's none yet. */
export function cachedWorkingFile(source: Source, range: { start: number; end: number }): Promise<{ file: string; span: WorkingSpan } | null> {
  const rate = workingFrameRate(source);
  return findCovering(path.join(cacheDir(), source.fingerprint, 'work'), WORKING_VERSION, rate, withinFrames(range, source.duration, rate));
}

/**
 * A working file holding `range` of the source: one from the cache if it
 * covers the range, else a new one. Rejects when the conversion fails or
 * `signal` aborts it.
 */
export async function ensureWorkingFile(
  source: Source,
  range: { start: number; end: number },
  options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<{ file: string; span: WorkingSpan }> {
  // A file made for this clip before it was trimmed, or for an overlapping clip.
  const cached = await cachedWorkingFile(source, range);
  if (cached) return cached;

  const rate = workingFrameRate(source);
  const dir = path.join(cacheDir(), source.fingerprint, 'work');

  const span = workingSpan(range, source, rate);
  const file = path.join(dir, workingFileName(span));
  await callWorker(
    'makeWorkingFile',
    [{
      sourcePath: source.path,
      start: spanStart(span),
      duration: spanEnd(span) - spanStart(span),
      frameRate: rate,
      colorSpace: source.video.colorSpace,
      height: source.video.height,
      out: file,
    }],
    { signal: options.signal, onProgress: (fraction) => options.onProgress?.(fraction as number) },
  );
  await prune(dir, WORKING_VERSION, KEEP);
  return { file, span };
}

/** The window no longer needs the working file it asked for (the clip is back inside the one it has); the conversion stops. */
export function cancelPrepare(sender: WebContents): void {
  running.get(sender.id)?.abort();
}

/** Parses a clip range sent by the renderer. */
export const parseRange = (range: unknown): { start: number; end: number } => rangeSchema.parse(range);

export async function prepareClip(sender: WebContents, sourceArg: unknown, rangeArg: unknown): Promise<PrepareResult> {
  const source = sourceSchema.parse(sourceArg);
  const range = parseRange(rangeArg);
  sourceUrl(source.path); // the same check as playing it: only a source we know

  running.get(sender.id)?.abort();
  const abort = new AbortController();
  running.set(sender.id, abort);
  try {
    const { file, span } = await ensureWorkingFile(source, range, {
      signal: abort.signal,
      onProgress: (fraction) => {
        if (!sender.isDestroyed()) sender.send('clip:prepare-progress', { fraction });
      },
    });
    return { ok: true, url: allowMedia(file), start: spanStart(span), end: spanEnd(span), frameRate: span.rate };
  } catch (e) {
    if (abort.signal.aborted) return { ok: false, error: 'cancelled' };
    return { ok: false, error: 'failed', detail: e instanceof Error ? e.message : String(e) };
  } finally {
    if (running.get(sender.id) === abort) running.delete(sender.id);
  }
}
