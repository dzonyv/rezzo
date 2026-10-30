/** Edits to the project's clips: making, renaming, trimming and deleting them. */
import { clipFromWords, moveEdge } from '../../../shared/clips.ts';
import type { Word } from '../../../shared/project.ts';
import { clipUiStore, openClip } from '../clip/state.ts';
import { projectStore } from './store.ts';

const store = () => projectStore.getState();

/** Makes a clip of these words and opens it. */
export function createClip(words: readonly Word[]): void {
  const source = store().project?.source;
  if (!source || words.length === 0) return;
  const clip = clipFromWords(words, source);
  store().edit('history.createClip', (d) => void d.clips.push(clip));
  openClip(clip.id);
}

export function deleteClip(id: string): void {
  store().edit('history.deleteClip', (d) => {
    const i = d.clips.findIndex((c) => c.id === id);
    if (i >= 0) d.clips.splice(i, 1);
  });
  if (clipUiStore.getState().openClipId === id) openClip(null);
}

/** Renaming happens as you type; wrap it in a gesture so it's one undo step. */
export function renameClip(id: string, name: string): void {
  store().edit('history.renameClip', (d) => {
    const clip = d.clips.find((c) => c.id === id);
    if (clip) clip.name = name;
  });
}

/** Gives the clip the range of these words, the same way a new clip gets it. */
export function setClipWords(id: string, words: readonly Word[]): void {
  const source = store().project?.source;
  if (!source || words.length === 0) return;
  const { start, end } = clipFromWords(words, source);
  store().edit('history.trimClip', (d) => {
    const clip = d.clips.find((c) => c.id === id);
    if (clip) Object.assign(clip, { start, end });
  });
}

/** Moves the start or end of a clip by whole frames. */
export function nudgeClip(id: string, edge: 'start' | 'end', frames: number): void {
  const source = store().project?.source;
  if (!source) return;
  store().edit('history.trimClip', (d) => {
    const clip = d.clips.find((c) => c.id === id);
    if (clip) Object.assign(clip, moveEdge(clip, edge, frames, source));
  });
}
