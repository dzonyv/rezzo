/**
 * Exporting a clip. The main process asks where to save, makes sure the
 * clip has a working file, and then connects the page straight to the
 * media worker with a MessagePort: the page renders and sends frames, the
 * worker encodes them. It only steps in again to cancel.
 */
import { app, dialog, MessageChannelMain, shell, type BrowserWindow } from 'electron';
import path from 'node:path';
import { EXPORT_PORT_MESSAGE, type ExportJob, type ExportResult } from '../shared/api.ts';
import { fps } from '../shared/frames.ts';
import { clipSchema, sourceSchema } from '../shared/project.ts';
import { translate } from '../shared/translate.ts';
import { clipFrames, spanStart } from '../shared/working.ts';
import { allowMedia, sourceUrl } from './media-protocol.ts';
import { ensureWorkingFile, parseRange } from './clip.ts';
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

export function cancelExport(): void {
  running?.abort();
}

export async function startExport(win: BrowserWindow, sourceArg: unknown, clipArg: unknown): Promise<ExportResult | null> {
  const source = sourceSchema.parse(sourceArg);
  const clip = clipSchema.parse(clipArg);
  const range = parseRange({ start: clip.start, end: clip.end });
  sourceUrl(source.path); // only a source the app knows
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
    await rememberExportDir(path.dirname(out));

    const progress = (fraction: number) => {
      if (!sender.isDestroyed()) sender.send('export:prepare-progress', { fraction });
    };
    // Tells the page a file was chosen, even when the working file is already there.
    progress(0);
    const { file, span } = await ensureWorkingFile(source, range, { signal: abort.signal, onProgress: progress });
    const encoder = await callWorker('pickEncoder', []);
    const placement = { start: spanStart(span), frameRate: span.rate };
    const { first, count } = clipFrames(placement, range);
    abort.signal.throwIfAborted();

    const { port1, port2 } = new MessageChannelMain();
    const started = performance.now();
    const encoding = callWorker(
      'encodeExport',
      [{
        out,
        workingFile: file,
        audioStart: range.start - placement.start,
        duration: count / fps(span.rate),
        frameRate: span.rate,
        frames: count,
        encoder,
      }],
      { signal: abort.signal, transfer: [port2] },
    );
    const job: ExportJob = { clipId: clip.id, url: allowMedia(file), ...placement, first, count };
    sender.postMessage(EXPORT_PORT_MESSAGE, job, [port1]);
    await encoding;

    lastExport = out;
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
