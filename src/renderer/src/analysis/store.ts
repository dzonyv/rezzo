/**
 * The open clip's analysis: from the cache next to its working file, or
 * made in the background once the working file is ready. One at a time; a
 * new working file cancels the analysis of the old one.
 */
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { ClipAnalysis } from '../../../shared/analysis.ts';
import { clipUiStore } from '../clip/state.ts';
import type { WorkingFile } from '../render/clip-player.ts';
import { analyseClip } from './analyse.ts';

export interface AnalysisState {
  /** The working file the rest is about. */
  url: string | null;
  status: 'idle' | 'running' | 'ready' | 'failed';
  progress: number;
  analysis: ClipAnalysis | null;
  detail: string | null;
}

const idle: AnalysisState = { url: null, status: 'idle', progress: 0, analysis: null, detail: null };
export const analysisStore = createStore<AnalysisState>()(() => idle);

export function useAnalysis<T>(select: (s: AnalysisState) => T): T {
  return useStore(analysisStore, select);
}

let running: AbortController | undefined;

/** Makes sure the analysis of this working file is there or on its way. */
export async function analyse(file: WorkingFile): Promise<void> {
  const s = analysisStore.getState();
  if (s.url === file.url && s.status !== 'failed') return;
  running?.abort();
  const abort = new AbortController();
  running = abort;
  analysisStore.setState({ url: file.url, status: 'running', progress: 0, analysis: null, detail: null });
  try {
    let analysis = await window.rezzo.invoke('analysis:load', file.url);
    if (!analysis) {
      analysis = await analyseClip(file, (progress) => !abort.signal.aborted && analysisStore.setState({ progress }), abort.signal);
      await window.rezzo.invoke('analysis:save', file.url, analysis);
    }
    if (!abort.signal.aborted) analysisStore.setState({ status: 'ready', progress: 1, analysis });
  } catch (e) {
    if (!abort.signal.aborted) analysisStore.setState({ status: 'failed', detail: e instanceof Error ? e.message : String(e) });
  } finally {
    if (running === abort) running = undefined;
  }
}

/** The clip editor closed: nothing to analyse any more. */
export function stopAnalysis(): void {
  running?.abort();
  running = undefined;
  analysisStore.setState(idle);
}

clipUiStore.subscribe((s) => {
  if (s.openClipId === null && analysisStore.getState().url) stopAnalysis();
});

// For the end-to-end tests: what the analysis found, a way to run it on any working file, and to put people in a synthetic clip.
Object.assign(window, {
  __rezzoAnalysis: {
    state: () => analysisStore.getState(),
    run: (file: WorkingFile) => analyse(file),
    set: (analysis: ClipAnalysis) => analysisStore.setState({ status: 'ready', analysis }),
  },
});
