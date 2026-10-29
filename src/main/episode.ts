/** Importing the source episode and finding it again when it has moved. */
import { dialog, type BrowserWindow, type WebContents } from 'electron';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { ImportResult, LocateResult, SourceStatus } from '../shared/api.ts';
import { sourceSchema, type Source } from '../shared/project.ts';
import { translate } from '../shared/translate.ts';
import { WorkerError } from '../shared/worker-api.ts';
import { allowMedia, rememberSource, sourceUrl } from './media-protocol.ts';
import { cacheDir } from './paths.ts';
import { getSettings } from './settings.ts';
import { callWorker } from './worker-host.ts';

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
    const [probed, fingerprint] = await Promise.all([callWorker('probe', [file]), callWorker('fingerprint', [file])]);
    rememberSource(file);
    return { ok: true, source: { path: file, size, fingerprint, ...probed } };
  } catch (e) {
    if (e instanceof WorkerError && (e.code === 'unreadable' || e.code === 'no-video')) return { ok: false, error: e.code };
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
 * A small H.264 copy of the source for formats Chromium can't play (HEVC
 * without hardware support, some MKVs). Made once per source, in the cache.
 */
export async function makePreview(sender: WebContents, source: unknown): Promise<string> {
  const { path: file, fingerprint, duration } = sourceSchema.parse(source);
  sourceUrl(file); // the same check: only a source we know
  const out = path.join(cacheDir(), fingerprint, 'preview-480p.mp4');
  await callWorker('makePreview', [{ sourcePath: file, duration, out }], {
    onProgress: (fraction) => {
      if (!sender.isDestroyed()) sender.send('episode:preview-progress', { fingerprint, fraction: fraction as number });
    },
  });
  return allowMedia(out);
}
