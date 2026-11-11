/**
 * How loud a clip's own sound and the user's sound files are
 * (shared/loudness.ts), measured once in the media worker and remembered
 * for as long as the app runs. The preview asks for it here and the export
 * uses the same function, so both even out by the same gain.
 */
import { stat } from 'node:fs/promises';
import { audioAssetSchema } from '../shared/assets.ts';
import { fps } from '../shared/frames.ts';
import type { Loudness } from '../shared/loudness.ts';
import { clipSchema, sourceSchema, type Clip } from '../shared/project.ts';
import { keptPieces } from '../shared/skips.ts';
import type { LoudnessRequest } from '../shared/worker-api.ts';
import { clipFrames, spanStart, type WorkingSpan } from '../shared/working.ts';
import { cachedWorkingFile, parseRange } from './clip.ts';
import { assetUrl, sourceUrl } from './media-protocol.ts';
import { callWorker } from './worker-host.ts';

/** Measurements kept; the oldest goes first. */
const KEEP = 200;
const measured = new Map<string, Promise<Loudness | number[]>>();

/** Measures `request` with `method` unless the same file, unchanged, was measured that way over the same stretches before. */
function remembered(method: 'measureLoudness', request: LoudnessRequest): Promise<Loudness>;
function remembered(method: 'measureLevels', request: LoudnessRequest): Promise<number[]>;
async function remembered(method: 'measureLoudness' | 'measureLevels', request: LoudnessRequest): Promise<Loudness | number[]> {
  const { size, mtimeMs } = await stat(request.file);
  const key = JSON.stringify([method, request.file, size, mtimeMs, request.pieces]);
  let held = measured.get(key);
  if (!held) {
    held = method === 'measureLevels' ? callWorker('measureLevels', [request]) : callWorker('measureLoudness', [request]);
    measured.set(key, held);
    held.catch(() => measured.delete(key));
    if (measured.size > KEEP) measured.delete(measured.keys().next().value!);
  }
  return held;
}

const measure = (request: LoudnessRequest): Promise<Loudness> => remembered('measureLoudness', request);

/**
 * The frames of a working file `span` that the clip plays, and the same as
 * seconds into the file: the export's pieces of picture and of sound.
 */
export function clipPieces(clip: Clip, span: WorkingSpan) {
  const placement = { start: spanStart(span), frameRate: span.rate };
  const frames = keptPieces(clip).map((p) => clipFrames(placement, p)).filter((p) => p.count > 0);
  const seconds = frames.map((p) => ({ start: p.first / fps(span.rate), duration: p.count / fps(span.rate) }));
  return { placement, frames, seconds };
}

/** How loud the clip's own sound is in `file` (its working file over `span`), over what it plays. */
export const clipLoudnessIn = (file: string, span: WorkingSpan, clip: Clip): Promise<Loudness> => measure({ file, pieces: clipPieces(clip, span).seconds });

/** How loud a sound file is, all of it. */
export const fileLoudness = (file: string): Promise<Loudness> => measure({ file, pieces: null });

/**
 * For the preview: how loud the clip's own sound is, or null when the
 * source has none or its working file isn't there yet (it's being made).
 */
export async function clipLoudness(sourceArg: unknown, clipArg: unknown): Promise<Loudness | null> {
  const source = sourceSchema.parse(sourceArg);
  const clip = clipSchema.parse(clipArg);
  sourceUrl(source.path); // only a source the app knows
  if (!source.audio) return null;
  const working = await cachedWorkingFile(source, parseRange({ start: clip.start, end: clip.end }));
  return working ? clipLoudnessIn(working.file, working.span, clip) : null;
}

/** The level of the clip's own sound in `file` (its working file over `span`) every DUCK_STEP of what it plays: where speech is (shared/ducking.ts). */
export const clipLevelsIn = (file: string, span: WorkingSpan, clip: Clip): Promise<number[]> => remembered('measureLevels', { file, pieces: clipPieces(clip, span).seconds });

/**
 * For the preview: the level of the clip's own sound, as clipLevelsIn, or
 * null when the source has none or its working file isn't there yet.
 */
export async function clipLevels(sourceArg: unknown, clipArg: unknown): Promise<number[] | null> {
  const source = sourceSchema.parse(sourceArg);
  const clip = clipSchema.parse(clipArg);
  sourceUrl(source.path); // only a source the app knows
  if (!source.audio) return null;
  const working = await cachedWorkingFile(source, parseRange({ start: clip.start, end: clip.end }));
  return working ? clipLevelsIn(working.file, working.span, clip) : null;
}

/** For the preview: how loud a sound file of the user's is. */
export function assetLoudness(assetArg: unknown): Promise<Loudness> {
  const asset = audioAssetSchema.parse(assetArg);
  assetUrl(asset.path); // only a file the app knows
  return fileLoudness(asset.path);
}
