/** Importing the source episode and finding it again when it has moved. */
import { dialog, type BrowserWindow, type WebContents } from 'electron';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ImportResult, LocateResult, SourceStatus } from '../shared/api.ts';
import { sourceSchema, type Source } from '../shared/project.ts';
import { translate } from '../shared/translate.ts';
import { THUMBNAIL_HEIGHTS, WorkerError } from '../shared/worker-api.ts';
import { allowMedia, rememberSource, sourceUrl } from './media-protocol.ts';
import { cacheDir } from './paths.ts';
import { getSettings } from './settings.ts';
import { callWorker, READ_TIMEOUT_MS } from './worker-host.ts';

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'avi', 'ts', 'mts', 'm2ts', 'flv', 'wmv'];

export async function chooseEpisode(win: BrowserWindow): Promise<string | null> {
  const { uiLanguage } = await getSettings();
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: translate(uiLanguage, 'files.video'), extensions: VIDEO_EXTENSIONS },
      { name: translate(uiLanguage, 'files.all'), extensions: ['*'] },
    ],
  });
  return canceled ? null : (filePaths[0] ?? null);
}

export async function importEpisode(file: string): Promise<ImportResult> {
  let size: number;
  try {
    const info = await stat(file);
    if (!info.isFile()) return { ok: false, error: 'not-found' };
    size = info.size;
  } catch {
    return { ok: false, error: 'not-found' };
  }
  try {
    const [probed, fingerprint] = await Promise.all([callWorker('probe', [file], { timeoutMs: READ_TIMEOUT_MS }), callWorker('fingerprint', [file], { timeoutMs: READ_TIMEOUT_MS })]);
    rememberSource(file);
    return { ok: true, source: { path: file, size, fingerprint, ...probed } };
  } catch (e) {
    if (e instanceof WorkerError && (e.code === 'unreadable' || e.code === 'no-video' || e.code === 'timeout')) return { ok: false, error: e.code };
    throw e;
  }
}

/** Whether the source is still where the project says, and still the same size. */
export async function checkEpisode(source: unknown): Promise<SourceStatus> {
  const { path, size } = sourceSchema.parse(source);
  try {
    return (await stat(path)).size === size ? 'ok' : 'changed';
  } catch {
    return 'missing';
  }
}

/** Asks for the source's new location and accepts only the same video. */
export async function locateEpisode(win: BrowserWindow, source: unknown): Promise<LocateResult | null> {
  const expected: Source = sourceSchema.parse(source);
  const file = await chooseEpisode(win);
  if (!file) return null;
  const imported = await importEpisode(file);
  if (!imported.ok) return imported;
  if (imported.source.fingerprint !== expected.fingerprint) return { ok: false, error: 'different-file' };
  return imported;
}

/** A URL the page can play the source from. */
export async function episodeMediaUrl(source: unknown): Promise<string> {
  return sourceUrl(sourceSchema.parse(source).path);
}

/**
 * What's being made for each open episode (by fingerprint): its preview and
 * its clips' thumbnails. Closing the episode stops all of it (stopEpisodeWork).
 */
const episodeWork = new Map<string, AbortController>();

function workSignal(fingerprint: string): AbortSignal {
  let abort = episodeWork.get(fingerprint);
  if (!abort) episodeWork.set(fingerprint, (abort = new AbortController()));
  return abort.signal;
}

/** Stops the preview and thumbnails being made for an episode that was closed. What's made already stays in the cache. */
export function stopEpisodeWork(fingerprint: unknown): void {
  const key = z.string().parse(fingerprint);
  episodeWork.get(key)?.abort();
  episodeWork.delete(key);
}

/** Previews being made, by output file, with the windows that asked: asking twice shares one FFmpeg. */
const makingPreviews = new Map<string, { done: Promise<string>; senders: Set<WebContents>; signal: AbortSignal }>();

/**
 * A small H.264 copy of the source for formats Chromium can't play (HEVC
 * without hardware support, some MKVs). Made once per source, in the cache.
 */
export function makePreview(sender: WebContents, source: unknown): Promise<string> {
  const { path: file, fingerprint, duration } = sourceSchema.parse(source);
  sourceUrl(file); // the same check: only a source we know
  const out = path.join(cacheDir(), fingerprint, 'preview-480p.mp4');
  let making = makingPreviews.get(out);
  // One stopped when its episode was closed is still on its way out; the episode opened again makes a new one.
  if (!making || making.signal.aborted) {
    const senders = new Set<WebContents>();
    const signal = workSignal(fingerprint);
    const done: Promise<string> = callWorker('makePreview', [{ sourcePath: file, duration, out }], {
      signal,
      onProgress: (fraction) => {
        for (const s of senders) {
          if (s.isDestroyed()) senders.delete(s);
          else s.send('episode:preview-progress', { fingerprint, fraction: fraction as number });
        }
      },
    })
      .then(() => allowMedia(out))
      .finally(() => {
        if (makingPreviews.get(out)?.done === done) makingPreviews.delete(out);
      });
    makingPreviews.set(out, (making = { done, senders, signal }));
  }
  making.senders.add(sender);
  return making.done;
}

/** Thumbnails being made, by output file, so two cards asking for the same one share the work. */
const makingThumbnails = new Map<string, { done: Promise<string>; signal: AbortSignal }>();
/** A thumbnail takes well under a second; one that takes this long would hold up the rest. */
const THUMBNAIL_TIMEOUT_MS = 30_000;
/** One at a time: a project with many clips shouldn't start an FFmpeg for each at once. */
let thumbnailQueue: Promise<unknown> = Promise.resolve();

/** A picture of the source at `time`, made once per source, time and size, in the cache. */
export function episodeThumbnail(source: unknown, time: unknown, size: unknown): Promise<string> {
  const { path: file, fingerprint, duration } = sourceSchema.parse(source);
  const kind = z.enum(['card', 'large']).default('card').parse(size);
  const height = THUMBNAIL_HEIGHTS[kind];
  // Not the very end: FFmpeg has no frame to give there.
  const at = Math.min(Math.max(z.number().finite().parse(time), 0), Math.max(0, duration - 0.5));
  sourceUrl(file); // the same check: only a source we know
  // Cards keep the folder they always had, so pictures already made still count.
  const out = path.join(cacheDir(), fingerprint, kind === 'card' ? 'thumbnails' : `thumbnails-${height}`, `${Math.round(at * 1000)}.jpg`);
  let making = makingThumbnails.get(out);
  // One stopped when its episode was closed may not have failed yet; the episode opened again asks anew.
  if (!making || making.signal.aborted) {
    const signal = workSignal(fingerprint);
    // Waiting its turn costs nothing once the episode is closed: a stopped call never reaches the worker.
    const done = thumbnailQueue
      .then(() => callWorker('makeThumbnail', [{ sourcePath: file, time: at, height, out }], { signal, timeoutMs: THUMBNAIL_TIMEOUT_MS }))
      .then(() => allowMedia(out));
    thumbnailQueue = done.catch(() => undefined);
    makingThumbnails.set(out, (making = { done, signal }));
    // Only while it's being made: the next ask finds the file in the cache, or makes it again if the cache was cleared.
    const forget = () => {
      if (makingThumbnails.get(out)?.done === done) makingThumbnails.delete(out);
    };
    done.then(forget, forget);
  }
  return making.done;
}
