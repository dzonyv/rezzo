/**
 * Which clip the editor has open, and which of its layers is selected. Not
 * part of the document: opening a clip isn't an edit. If undo removes the
 * open clip or the selected layer, it simply isn't found.
 */
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { AutoFrameOptions } from '../../../shared/autoframe.ts';
import type { Clip } from '../../../shared/project.ts';
import { projectStore, useProject } from '../project/store.ts';

interface ClipUiState {
  openClipId: string | null;
  /** A layer over the picture being edited; null for the picture itself and its captions. */
  selectedLayerId: string | null;
  /** How Auto frame frames; the same for every clip until the app closes. */
  frameOptions: AutoFrameOptions;
}

export const clipUiStore = createStore<ClipUiState>()(() => ({ openClipId: null, selectedLayerId: null, frameOptions: { width: 'medium', change: 'cut' } }));

export function openClip(id: string | null): void {
  clipUiStore.setState({ openClipId: id, selectedLayerId: null });
}

export function selectLayer(id: string | null): void {
  clipUiStore.setState({ selectedLayerId: id });
}

export function setFrameOptions(options: Partial<AutoFrameOptions>): void {
  clipUiStore.setState((s) => ({ frameOptions: { ...s.frameOptions, ...options } }));
}

// A different project starts with no clip open.
projectStore.subscribe((s, prev) => {
  if (s.project?.id !== prev.project?.id) openClip(null);
});

export function useOpenClipId(): string | null {
  return useStore(clipUiStore, (s) => s.openClipId);
}

export function useSelectedLayerId(): string | null {
  return useStore(clipUiStore, (s) => s.selectedLayerId);
}

export function useFrameOptions(): AutoFrameOptions {
  return useStore(clipUiStore, (s) => s.frameOptions);
}

/** The open clip as it is in the document now, or null. */
export function useOpenClip(): Clip | null {
  const id = useOpenClipId();
  return useProject((s) => s.project?.clips.find((c) => c.id === id) ?? null);
}
