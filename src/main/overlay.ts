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
import { spanEnd, spanStart, workingFileName, workingSpan, type WorkingSpan } from '../shared/working.ts';
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
 * of the same file (or the preview and an export) wait for one conversion.
 */
const running = new Map<string, { done: Promise<void>; listeners: Set<(fraction: number) => void> }>();

/**
 * A working file holding `range` (seconds of the layer's file) at `rate`:
 * one from the cache if it covers the range, else a new one. Rejects when
 * the conversion fails.
 */
export async function ensureOverlayFile(
  asset: VideoAsset,
  range: { start: number; end: number },
  rate: FrameRate,
  onProgress?: (fraction: number) => void,
): Promise<{ file: string; span: WorkingSpan }> {
  const dir = path.join(cacheDir(), asset.fingerprint, 'overlay');
  const cached = await findCovering(dir, OVERLAY_VERSION, rate, range);
  if (cached) return cached;

  const span = workingSpan(range, asset, rate);
  const file = path.join(dir, workingFileName(span, OVERLAY_VERSION));
  let job = running.get(file);
  if (!job) {
    const listeners = new Set<(fraction: number) => void>();
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
      { onProgress: (fraction) => listeners.forEach((l) => l(fraction as number)) },
    )
      .then(() => prune(dir, OVERLAY_VERSION, KEEP))
      .finally(() => running.delete(file));
    job = { done, listeners };
    running.set(file, job);
  }
  if (onProgress) job.listeners.add(onProgress);
  try {
    await job.done;
  } finally {
    if (onProgress) job.listeners.delete(onProgress);
  }
  return { file, span };
}

export async function prepareOverlay(sender: WebContents, assetArg: unknown, rangeArg: unknown, rateArg: unknown, requestId: unknown): Promise<OverlayPrepareResult> {
  const asset = videoAssetSchema.parse(assetArg);
  const range = rangeSchema.parse(rangeArg);
  const rate = rateSchema.parse(rateArg);
  const id = z.string().parse(requestId);
  assetUrl(asset.path); // the same check as reading it: only a file we know

  try {
    await stat(asset.path);
  } catch {
    return { ok: false, error: 'missing' };
  }
  try {
    const { file, span } = await ensureOverlayFile(asset, range, rate, (fraction) => {
      if (!sender.isDestroyed()) sender.send('overlay:prepare-progress', { requestId: id, fraction });
    });
    return { ok: true, url: allowMedia(file), start: spanStart(span), end: spanEnd(span), frameRate: span.rate, layout: overlayLayout(asset) };
  } catch (e) {
    return { ok: false, error: 'failed', detail: e instanceof Error ? e.message : String(e) };
  }
}
