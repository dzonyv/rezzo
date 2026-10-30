/**
 * The export in progress (one at a time) and the actions that start and
 * stop it. The main process asks where to save and prepares the working
 * file; then the page renders the frames (export-job.ts) while the media
 * worker encodes them, and export:start resolves with the result.
 */
import i18n from 'i18next';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { EXPORT_PORT_MESSAGE, type ExportJob } from '../../../shared/api.ts';
import { videoLayerOf, type Clip, type Source } from '../../../shared/project.ts';
import type { Encoder } from '../../../shared/worker-api.ts';
import { pauseClip } from '../clip/playback.ts';
import { pauseEpisode } from '../player/playback.ts';
import { notify } from '../ui/prompts.ts';
import { renderExport } from './export-job.ts';

export type ExportState =
  | { status: 'idle' }
  /** The save dialog is open. */
  | { status: 'choosing'; clipName: string }
  | { status: 'preparing'; clipName: string; fraction: number }
  /** `left`: estimated seconds to go, null until there's enough to go by. */
  | { status: 'rendering'; clipName: string; done: number; total: number; startedAt: number; left: number | null }
  /** Every frame is with the encoder; it's finishing the file. */
  | { status: 'finishing'; clipName: string }
  | { status: 'done'; clipName: string; path: string; seconds: number; encoder: Encoder }
  | { status: 'failed'; clipName: string; detail: string };

export const exportStore = createStore<ExportState>()(() => ({ status: 'idle' }));

export function useExport<T>(select: (s: ExportState) => T): T {
  return useStore(exportStore, select);
}

/** True while an export is running (not when its result is on screen). */
export const isExporting = (s: ExportState = exportStore.getState()): boolean =>
  s.status === 'choosing' || s.status === 'preparing' || s.status === 'rendering' || s.status === 'finishing';

/** The first frames are slow (the GPU warming up); the estimate waits for them. */
const LEFT_AFTER_FRAMES = 30;

let abort: AbortController | null = null;

/** Calls `onJob` with the export's job and port when the main process sends them. */
function onExportPort(onJob: (job: ExportJob, port: MessagePort) => void): () => void {
  const listener = (e: MessageEvent) => {
    if (e.source !== window || e.data?.type !== EXPORT_PORT_MESSAGE || !e.ports[0]) return;
    onJob(e.data.job as ExportJob, e.ports[0]);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

export async function exportClip(clip: Clip, source: Source): Promise<void> {
  if (isExporting()) return;
  pauseClip();
  pauseEpisode();
  const clipName = clip.name || i18n.t('clips.untitled');
  const layer = videoLayerOf(clip);
  const controller = new AbortController();
  abort = controller;
  exportStore.setState({ status: 'choosing', clipName }, true);

  const stopProgress = window.rezzo.on('export:prepare-progress', ({ fraction }) => {
    const s = exportStore.getState();
    if (s.status === 'choosing' || s.status === 'preparing') exportStore.setState({ status: 'preparing', clipName, fraction }, true);
  });
  let rendering: Promise<void> | undefined;
  const stopListening = onExportPort((job, port) => {
    if (job.clipId !== clip.id || rendering) {
      port.close();
      return;
    }
    exportStore.setState({ status: 'rendering', clipName, done: 0, total: job.count, startedAt: performance.now(), left: null }, true);
    rendering = renderExport(job, port, layer, {
      signal: controller.signal,
      onProgress: (done) => {
        const s = exportStore.getState();
        if (s.status !== 'rendering') return;
        if (done === s.total) {
          exportStore.setState({ status: 'finishing', clipName }, true);
          return;
        }
        const perFrame = (performance.now() - s.startedAt) / 1000 / done;
        exportStore.setState({ ...s, done, left: done < LEFT_AFTER_FRAMES ? null : perFrame * (s.total - done) }, true);
      },
    });
    // Its failure reaches the encoder, and so the result below; nothing to do here.
    rendering.catch(() => {});
  });

  try {
    const result = await window.rezzo.invoke('export:start', source, clip);
    // A cancel can reach the encoder from this page before main hears of it,
    // and then come back as a failure; it's still a cancel.
    const cancelled = controller.signal.aborted;
    // The export is over either way; rendering stops if it hasn't.
    controller.abort();
    await rendering?.catch(() => {});
    if (result?.ok) {
      exportStore.setState({ status: 'done', clipName, path: result.path, seconds: result.seconds, encoder: result.encoder }, true);
    } else if (result?.error === 'failed' && !cancelled) {
      exportStore.setState({ status: 'failed', clipName, detail: result.detail }, true);
    } else {
      // The dialog or the export was cancelled, or another one is running.
      exportStore.setState({ status: 'idle' }, true);
      if (result?.error === 'busy') notify('error', i18n.t('export.busy'));
    }
  } catch (e) {
    controller.abort();
    exportStore.setState({ status: 'failed', clipName, detail: e instanceof Error ? e.message : String(e) }, true);
  } finally {
    stopProgress();
    stopListening();
    if (abort === controller) abort = null;
  }
}

/** Stops the running export; the partial file is deleted. */
export async function cancelExport(): Promise<void> {
  const running = abort;
  // Main first, so the result says "cancelled" whenever it can.
  const told = window.rezzo.invoke('export:cancel');
  running?.abort();
  await told;
}

/** Puts the dialog away after a result. */
export function dismissExport(): void {
  if (!isExporting()) exportStore.setState({ status: 'idle' }, true);
}
