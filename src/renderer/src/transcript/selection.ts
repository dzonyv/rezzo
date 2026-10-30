/**
 * Picking a run of words in the transcript: press on a word and drag, or
 * Shift+click to extend. Words are kept as indices into the flat word
 * list, so the selection survives rows scrolling out of the virtual list.
 * It isn't part of the document, so there's nothing to undo.
 */
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

interface SelectionState {
  /** Where the selection started, or null when nothing is selected. */
  anchor: number | null;
  /** Where it ends; may be before the anchor. */
  focus: number | null;
  dragging: boolean;
  /** Whether the pointer moved to another word since it was pressed. */
  moved: boolean;
}

export const selectionStore = createStore<SelectionState>()(() => ({ anchor: null, focus: null, dragging: false, moved: false }));

export function useSelection<T>(select: (s: SelectionState) => T): T {
  return useStore(selectionStore, select);
}

/** The selected words, first to last, or null. */
export function selectedRange(s: SelectionState): { first: number; last: number } | null {
  if (s.anchor === null || s.focus === null) return null;
  return { first: Math.min(s.anchor, s.focus), last: Math.max(s.anchor, s.focus) };
}

export function pressWord(index: number, extend: boolean): void {
  const { anchor } = selectionStore.getState();
  if (extend && anchor !== null) {
    selectionStore.setState({ focus: index, dragging: false, moved: true });
  } else {
    selectionStore.setState({ anchor: index, focus: index, dragging: true, moved: false });
  }
}

export function enterWord(index: number): void {
  const s = selectionStore.getState();
  if (!s.dragging || s.focus === index) return;
  selectionStore.setState({ focus: index, moved: s.moved || index !== s.anchor });
}

/**
 * Ends a press. Returns "click" when the pointer never left the word it
 * pressed: that's a click to play from there, and selects nothing.
 */
export function release(): 'click' | 'select' | null {
  const s = selectionStore.getState();
  if (s.anchor === null) return null;
  const wasDrag = s.dragging;
  selectionStore.setState({ dragging: false });
  if (wasDrag && !s.moved) {
    clearSelection();
    return 'click';
  }
  return 'select';
}

export function clearSelection(): void {
  selectionStore.setState({ anchor: null, focus: null, dragging: false, moved: false });
}
