/**
 * Which word is being corrected, as an index into the flat word list. Not
 * part of the document; the corrections themselves are (project/transcript.ts).
 */
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export const editingStore = createStore<{ index: number | null }>()(() => ({ index: null }));

export function useEditing(): number | null {
  return useStore(editingStore, (s) => s.index);
}

export function startEditing(index: number): void {
  editingStore.setState({ index });
}

export function stopEditing(): void {
  editingStore.setState({ index: null });
}

/** How a correction ends, and where the editor goes next. */
export type Finish =
  | { kind: 'cancel' }
  | { kind: 'done' | 'next' | 'previous' | 'nextUnsure' | 'previousUnsure' | 'joinPrevious' | 'joinNext'; text: string };
