/** Corrections to the transcript's words; each one is a step to undo. */
import type { Draft } from 'immer';
import type { Segment } from '../../../shared/project.ts';
import { mergeWithNext, setWordText, setWordTiming, type WordRef } from '../../../shared/transcript-edit.ts';
import { projectStore, type EditLabel } from './store.ts';

function editSegments<R>(label: EditLabel, recipe: (segments: Draft<Segment>[]) => R, fallback: R): R {
  let result = fallback;
  projectStore.getState().edit(label, (d) => {
    if (d.transcript) result = recipe(d.transcript.segments);
  });
  return result;
}

/** New text for a word; see setWordText. Returns how many words now stand in its place. */
export function editWord(at: WordRef, text: string): number {
  return editSegments('history.editWord', (s) => setWordText(s, at, text), 1);
}

/** Joins a word with the one after it. */
export function joinWords(at: WordRef): boolean {
  return editSegments('history.joinWords', (s) => mergeWithNext(s, at), false);
}

/** Moves a word's start and end; inside a gesture while dragging. */
export function retimeWord(at: WordRef, start: number, end: number): void {
  editSegments('history.retimeWord', (s) => setWordTiming(s, at, start, end), undefined);
}
