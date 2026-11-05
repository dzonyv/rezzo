/**
 * Which clip the editor has open, and which of its layers is selected. Not
 * part of the document: opening a clip isn't an edit. If undo removes the
 * open clip or the selected layer, it simply isn't found.
 */
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { AutoFrameOptions } from '../../../shared/autoframe.ts';
import type { Clip } from '../../../shared/project.ts';
import { DEFAULT_PAUSE_OPTIONS, type PauseOptions, type Span } from '../../../shared/skips.ts';
import { projectStore, useProject } from '../project/store.ts';

/** A pause found in a clip, not cut yet; `on` until the user switches it off on the timeline. */
export type FoundPause = Span & { on: boolean };

interface ClipUiState {
  openClipId: string | null;
  /** A layer over the picture being edited; null for the picture itself and its captions. */
  selectedLayerId: string | null;
  /** How Auto frame frames; the same for every clip until the app closes. */
  frameOptions: AutoFrameOptions;
  /** How pauses are looked for; the same for every clip until the app closes. */
  pauseOptions: PauseOptions;
  /** Pauses waiting to be cut. */
  found: { clipId: string; pauses: FoundPause[] } | null;
}

export const clipUiStore = createStore<ClipUiState>()(() => ({
  openClipId: null,
  selectedLayerId: null,
  frameOptions: { width: 'medium', change: 'cut' },
  pauseOptions: DEFAULT_PAUSE_OPTIONS,
  found: null,
}));

export function openClip(id: string | null): void {
  clipUiStore.setState({ openClipId: id, selectedLayerId: null, found: null });
}

export function selectLayer(id: string | null): void {
  clipUiStore.setState({ selectedLayerId: id });
}

export function setFrameOptions(options: Partial<AutoFrameOptions>): void {
  clipUiStore.setState((s) => ({ frameOptions: { ...s.frameOptions, ...options } }));
}

export function setPauseOptions(options: Partial<PauseOptions>): void {
  clipUiStore.setState((s) => ({ pauseOptions: { ...s.pauseOptions, ...options } }));
}

export function setFoundPauses(found: ClipUiState['found']): void {
  clipUiStore.setState({ found });
}

/** Switches a found pause on or off. */
export function toggleFoundPause(start: number): void {
  clipUiStore.setState((s) => (s.found ? { found: { ...s.found, pauses: s.found.pauses.map((p) => (p.start === start ? { ...p, on: !p.on } : p)) } } : s));
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

export function usePauseOptions(): PauseOptions {
  return useStore(clipUiStore, (s) => s.pauseOptions);
}

/** The pauses waiting to be cut in this clip, or null. */
export function useFoundPauses(clipId: string): FoundPause[] | null {
  return useStore(clipUiStore, (s) => (s.found?.clipId === clipId ? s.found.pauses : null));
}

/** The open clip as it is in the document now, or null. */
export function useOpenClip(): Clip | null {
  const id = useOpenClipId();
  return useProject((s) => s.project?.clips.find((c) => c.id === id) ?? null);
}
