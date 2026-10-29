/**
 * Which clip the editor has open. Not part of the document: opening a clip
 * isn't an edit. If undo removes the open clip, it simply isn't found.
 */
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Clip } from '../../../shared/project.ts';
import { projectStore, useProject } from '../project/store.ts';

export const clipUiStore = createStore<{ openClipId: string | null }>()(() => ({ openClipId: null }));

export function openClip(id: string | null): void {
  clipUiStore.setState({ openClipId: id });
}

// A different project starts with no clip open.
projectStore.subscribe((s, prev) => {
  if (s.project?.id !== prev.project?.id) openClip(null);
});

export function useOpenClipId(): string | null {
  return useStore(clipUiStore, (s) => s.openClipId);
}

/** The open clip as it is in the document now, or null. */
export function useOpenClip(): Clip | null {
  const id = useOpenClipId();
  return useProject((s) => s.project?.clips.find((c) => c.id === id) ?? null);
}
