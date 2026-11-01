/**
 * The running transcription, if any. It outlives the panel that started it,
 * and its result lands in the project only if that project is still open.
 */
import i18n from 'i18next';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { TranscriptLanguage } from '../../../shared/project.ts';
import { applyReplacements } from '../../../shared/replacements.ts';
import type { TranscribeProgress } from '../../../shared/worker-api.ts';
import { notify } from '../ui/prompts.ts';
import { projectStore } from './store.ts';

interface TranscriptionState {
  /** The project being transcribed, or null when nothing runs. */
  projectId: string | null;
  progress: TranscribeProgress | null;
}

const store = createStore<TranscriptionState>()(() => ({ projectId: null, progress: null }));

export function useTranscription<T>(select: (s: TranscriptionState) => T): T {
  return useStore(store, select);
}

window.rezzo.on('transcribe:progress', ({ projectId, progress }) => {
  if (store.getState().projectId === projectId) store.setState({ progress });
});

export async function startTranscription(language: TranscriptLanguage): Promise<void> {
  const project = projectStore.getState().project;
  if (!project?.source || store.getState().projectId) return;
  store.setState({ projectId: project.id, progress: null });
  void window.rezzo.invoke('settings:set', { transcriptLanguage: language });

  try {
    const result = await window.rezzo.invoke('transcribe:start', { projectId: project.id, source: project.source, language });
    if (result.ok) {
      // The replacement list fixes what Whisper always gets wrong before anyone sees it.
      const { replacements } = await window.rezzo.invoke('settings:get');
      applyReplacements(result.transcript.segments, replacements);
      if (projectStore.getState().project?.id === project.id) {
        projectStore.getState().replace((d) => void (d.transcript = result.transcript));
      }
    } else if (result.error === 'download-failed' || result.error === 'whisper-failed') {
      notify('error', i18n.t(`errors.transcribe.${result.error}`, { detail: result.detail }));
    } else if (result.error === 'no-audio') {
      notify('error', i18n.t('errors.transcribe.no-audio'));
    }
  } finally {
    store.setState({ projectId: null, progress: null });
  }
}

export function cancelTranscription(): void {
  if (store.getState().projectId) void window.rezzo.invoke('transcribe:cancel');
}
