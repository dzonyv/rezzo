/**
 * Working files for video layers: each layer's file is converted once, at
 * the clip's frame rate, and kept in the cache under the file's
 * fingerprint, the way clips' working files are kept under the source's.
 */
import type { WebContents } from 'electron';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { OverlayPrepareResult } from '../shared/api.ts';
import { videoAssetSchema, type VideoAsset } from '../shared/assets.ts';
import type { FrameRate } from '../shared/frames.ts';
import { OVERLAY_VERSION, overlayLayout } from '../shared/overlay-files.ts';
import { spanEnd, spanStart, withinFrames, workingFileName, workingSpan, type WorkingSpan } from '../shared/working.ts';
import { allowMedia, assetUrl } from './media-protocol.ts';
import { cacheDir } from './paths.ts';
import { callWorker } from './worker-host.ts';
import { findCovering, prune } from './working-cache.ts';

/** Working files kept per layer file; older ones are deleted. */
const KEEP = 10;

const rangeSchema = z
  .object({ start: z.number().finite().nonnegative(), end: z.number().finite() })
  .refine((r) => r.end >= r.start);
const rateSchema = z.tuple([z.number().int().positive(), z.number().int().positive()]);

/**
 * Conversions under way, by output file. Two layers showing the same part
 * of the same file (or the preview and an export) wait for one conversion;
 * it's cancelled once nobody waits for it any more.
 */
const running = new Map<string, { done: Promise<void>; listeners: Set<(fraction: number) => void>; waiting: number; abort: AbortController }>();

/** Preview requests by the id the page gave them, so the page can cancel one it no longer needs. */
const requests = new Map<string, AbortController>();

/**
 * A working file holding `range` (seconds of the layer's file) at `rate`:
 * one from the cache if it covers the range, else a new one. Rejects when
 * the conversion fails, or when `signal` aborts this caller's wait.
 */
export async function ensureOverlayFile(
  asset: VideoAsset,
  rangeArg: { start: number; end: number },
  rate: FrameRate,
  { onProgress, signal }: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<{ file: string; span: WorkingSpan }> {
  signal?.throwIfAborted();
  const range = withinFrames(rangeArg, asset.duration, rate);
  const dir = path.join(cacheDir(), asset.fingerprint, 'overlay');
  const cached = await findCovering(dir, OVERLAY_VERSION, rate, range);
  if (cached) return cached;
  signal?.throwIfAborted();

  const span = workingSpan(range, asset, rate);
  const file = path.join(dir, workingFileName(span, OVERLAY_VERSION));
  let job = running.get(file);
  if (!job) {
    const listeners = new Set<(fraction: number) => void>();
    const abort = new AbortController();
    const { width, height } = overlayLayout(asset);
    const done = callWorker(
      'makeOverlayFile',
      [{
        path: asset.path,
        codec: asset.codec,
        colorSpace: asset.colorSpace,
        sourceHeight: asset.height,
        alpha: asset.alpha,
        start: spanStart(span),
        duration: spanEnd(span) - spanStart(span),
        frameRate: rate,
        width,
        height,
        out: file,
      }],
      { signal: abort.signal, onProgress: (fraction) => listeners.forEach((l) => l(fraction as number)) },
    )
      // Tidying the cache is a courtesy; failing at it doesn't fail the file.
      .then(() => prune(dir, OVERLAY_VERSION, KEEP).catch(() => {}))
      .finally(() => running.delete(file));
    // Seen by whoever waits; this only keeps an abandoned one from counting as unhandled.
    done.catch(() => {});
    job = { done, listeners, waiting: 0, abort };
    running.set(file, job);
  }
  const j = job;
  if (onProgress) j.listeners.add(onProgress);
  j.waiting++;
  try {
    await new Promise<void>((resolve, reject) => {
      j.done.then(resolve, reject);
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  } finally {
    if (onProgress) j.listeners.delete(onProgress);
    if (--j.waiting === 0 && running.get(file) === j) j.abort.abort();
  }
  return { file, span };
}

export async function prepareOverlay(sender: WebContents, assetArg: unknown, rangeArg: unknown, rateArg: unknown, requestId: unknown): Promise<OverlayPrepareResult> {
  const asset = videoAssetSchema.parse(assetArg);
  const range = rangeSchema.parse(rangeArg);
  const rate = rateSchema.parse(rateArg);
  const id = z.string().parse(requestId);
  assetUrl(asset.path); // the same check as reading it: only a file we know

  // Known before anything is awaited, so a cancel sent right after the request finds it.
  const abort = new AbortController();
  requests.set(id, abort);
  try {
    try {
      await stat(asset.path);
    } catch {
      return { ok: false, error: 'missing' };
    }
    const { file, span } = await ensureOverlayFile(asset, range, rate, {
      signal: abort.signal,
      onProgress: (fraction) => {
        if (!sender.isDestroyed()) sender.send('overlay:prepare-progress', { requestId: id, fraction });
      },
    });
    return { ok: true, url: allowMedia(file), start: spanStart(span), end: spanEnd(span), frameRate: span.rate, layout: overlayLayout(asset) };
  } catch (e) {
    if (abort.signal.aborted) return { ok: false, error: 'cancelled' };
    return { ok: false, error: 'failed', detail: e instanceof Error ? e.message : String(e) };
  } finally {
    requests.delete(id);
  }
}

/** The page no longer needs this request (the layer changed or went); its conversion stops if nobody else waits for it. */
export function cancelOverlay(requestId: unknown): void {
  requests.get(z.string().parse(requestId))?.abort();
}
