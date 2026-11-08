/**
 * Exporting a clip. The main process asks where to save, makes sure the
 * clip has a working file, and then connects the page straight to the
 * media worker with a MessagePort: the page renders and sends frames, the
 * worker encodes them. It only steps in again to cancel.
 */
import { app, dialog, MessageChannelMain, shell, type BrowserWindow } from 'electron';
import path from 'node:path';
import { z } from 'zod';
import { EXPORT_PORT_MESSAGE, type ExportJob, type ExportResult } from '../shared/api.ts';
import { assetSchema, type Asset } from '../shared/assets.ts';
import { fps, type FrameRate } from '../shared/frames.ts';
import { clipSoundPieces, overlayRange, videoLayersOf } from '../shared/overlay-files.ts';
import { clipSchema, sourceSchema, type Clip } from '../shared/project.ts';
import { playedSound, soundLayersOf, type PlayedSound } from '../shared/sound-mix.ts';
import type { ExportSound } from '../shared/worker-api.ts';
import { translate } from '../shared/translate.ts';
import { keptPieces } from '../shared/skips.ts';
import { clipFrames, spanStart } from '../shared/working.ts';
import { allowMedia, assetUrl, sourceUrl } from './media-protocol.ts';
import { ensureWorkingFile, parseRange } from './clip.ts';
import { ensureOverlayFile } from './overlay.ts';
import { librarySoundPath } from './sounds.ts';
import { getSettings, rememberExportDir } from './settings.ts';
import { callWorker } from './worker-host.ts';
import { safeFileName } from '../node/files.ts';

/** One export at a time. */
let running: AbortController | undefined;
/** The last file written; the only one the page may ask to show or open. */
let lastExport: string | undefined;

async function chooseExportFile(win: BrowserWindow, clipName: string): Promise<string | null> {
  const { uiLanguage, exportDir } = await getSettings();
  const name = safeFileName(clipName, 'mp4', translate(uiLanguage, 'clips.untitled'));
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(exportDir ?? app.getPath('videos'), name),
    filters: [{ name: translate(uiLanguage, 'files.mp4'), extensions: ['mp4'] }],
  });
  return canceled || !filePath ? null : filePath;
}

const exportSound = (file: string, played: PlayedSound, start: number): ExportSound => {
  const { at, length, volume, fadeIn, fadeOut } = played.envelope;
  return { file, start, duration: length, loop: played.loop, period: played.period, at, volume, fadeIn, fadeOut };
};

/** The sound layers' sound in the clip, straight from their files. Times are output time. */
function soundLayerSounds(clip: Clip, assets: readonly Asset[]): ExportSound[] {
  return soundLayersOf(clip, assets).flatMap(({ layer, duration, asset }) => {
    const played = layer.volume > 0 ? playedSound(clipSoundPieces(clip, layer, duration), duration, layer.volume, layer.fadeIn, layer.fadeOut) : null;
    if (!played) return [];
    const file = 'library' in layer.sound ? librarySoundPath(layer.sound.library) : asset!.path;
    return [exportSound(file, played, played.from)];
  });
}

/**
 * The video layers' sound in the clip, from their working files at `rate`
 * (made now if they aren't in the cache, reporting 0..1 as they are).
 * Times are output time.
 */
async function videoLayerSounds(
  clip: Clip,
  assets: readonly Asset[],
  rate: FrameRate,
  { signal, onProgress }: { signal: AbortSignal; onProgress: (fraction: number) => void },
): Promise<ExportSound[]> {
  const heard = videoLayersOf(clip, assets).filter(({ layer, asset }) => layer.volume > 0 && asset.hasAudio);
  const done = heard.map(() => 0);
  const sounds = await Promise.all(
    heard.map(async ({ layer, asset }, i) => {
      const played = playedSound(clipSoundPieces(clip, layer, asset.duration), asset.duration, layer.volume);
      if (!played) return [];
      const { file, span } = await ensureOverlayFile(asset, overlayRange(layer, asset), rate, {
        signal,
        onProgress: (fraction) => {
          done[i] = fraction;
          onProgress(done.reduce((a, b) => a + b, 0) / done.length);
        },
      });
      return [exportSound(file, played, Math.max(0, played.from - spanStart(span)))];
    }),
  );
  return sounds.flat();
}

export function cancelExport(): void {
  running?.abort();
}

export async function startExport(win: BrowserWindow, sourceArg: unknown, clipArg: unknown, assetsArg: unknown): Promise<ExportResult | null> {
  const source = sourceSchema.parse(sourceArg);
  const clip = clipSchema.parse(clipArg);
  const assets = z.array(assetSchema).parse(assetsArg);
  const range = parseRange({ start: clip.start, end: clip.end });
  sourceUrl(source.path); // only a source the app knows
  for (const a of assets) assetUrl(a.path); // and only layer files it knows
  if (running) return { ok: false, error: 'busy' };

  const abort = new AbortController();
  running = abort;
  // A page that goes away mid-export can't send the rest of the frames.
  const sender = win.webContents;
  const gone = () => abort.abort();
  sender.once('destroyed', gone);
  try {
    const out = await chooseExportFile(win, clip.name);
    if (!out) return null;

    const progress = (fraction: number) => {
      if (!sender.isDestroyed()) sender.send('export:prepare-progress', { fraction });
    };
    // Tells the page a file was chosen, even when the working file is already there.
    progress(0);
    const { file, span } = await ensureWorkingFile(source, range, { signal: abort.signal, onProgress: progress });
    const encoder = await callWorker('pickEncoder', []);
    const placement = { start: spanStart(span), frameRate: span.rate };
    const pieces = keptPieces(clip).map((p) => clipFrames(placement, p)).filter((p) => p.count > 0);
    const count = pieces.reduce((sum, p) => sum + p.count, 0);
    const sounds = [...(await videoLayerSounds(clip, assets, span.rate, { signal: abort.signal, onProgress: progress })), ...soundLayerSounds(clip, assets)];
    abort.signal.throwIfAborted();

    const { port1, port2 } = new MessageChannelMain();
    const started = performance.now();
    const encoding = callWorker(
      'encodeExport',
      [{
        out,
        workingFile: file,
        audioPieces: pieces.map((p) => ({ start: p.first / fps(span.rate), duration: p.count / fps(span.rate) })),
        duration: count / fps(span.rate),
        hasAudio: source.audio !== null,
        sounds,
        frameRate: span.rate,
        frames: count,
        encoder,
      }],
      { signal: abort.signal, transfer: [port2] },
    );
    const job: ExportJob = { clipId: clip.id, url: allowMedia(file), ...placement, pieces, count };
    sender.postMessage(EXPORT_PORT_MESSAGE, job, [port1]);
    await encoding;

    lastExport = out;
    await rememberExportDir(path.dirname(out));
    return { ok: true, path: out, seconds: (performance.now() - started) / 1000, encoder };
  } catch (e) {
    if (abort.signal.aborted) return { ok: false, error: 'cancelled' };
    return { ok: false, error: 'failed', detail: e instanceof Error ? e.message : String(e) };
  } finally {
    sender.off('destroyed', gone);
    if (running === abort) running = undefined;
  }
}

export function revealExport(): void {
  if (lastExport) shell.showItemInFolder(lastExport);
}

export async function openExport(): Promise<void> {
  if (lastExport) await shell.openPath(lastExport);
}
