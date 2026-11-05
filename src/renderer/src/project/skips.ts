/** Edits to what a clip leaves out (shared/skips.ts), and finding pauses to offer for that. */
import { workingFrameRate } from '../../../shared/frames.ts';
import type { Word } from '../../../shared/project.ts';
import { pausesOf, withoutSkipAt, withSkips, wordsSpan, type PauseOptions, type Span } from '../../../shared/skips.ts';
import { currentPlayer } from '../clip/playback.ts';
import { clipUiStore, setFoundPauses } from '../clip/state.ts';
import { LOUDNESS_STEP } from '../render/clip-player.ts';
import { flatOf } from '../transcript/words.ts';
import { projectStore } from './store.ts';

const store = () => projectStore.getState();

function addSkips(clipId: string, label: 'history.cutPauses' | 'history.cutWords', spans: readonly Span[]): void {
  const source = store().project?.source;
  if (!source || spans.length === 0) return;
  const rate = workingFrameRate(source);
  store().edit(label, (d) => {
    const clip = d.clips.find((c) => c.id === clipId);
    if (clip) clip.skips = withSkips(clip, spans, rate);
  });
}

/** Looks for pauses in the open clip and shows them on the timeline. Nothing is cut yet. */
export function findPauses(clipId: string, options: PauseOptions): void {
  const project = store().project;
  const clip = project?.clips.find((c) => c.id === clipId);
  const player = currentPlayer();
  const db = player?.loudness;
  if (!clip || !player || !db) return;
  const words = project?.transcript ? flatOf(project.transcript.segments).words : [];
  const pauses = pausesOf(clip, words, { db, step: LOUDNESS_STEP, start: player.file.start }, options);
  setFoundPauses({ clipId, pauses: pauses.map((p) => ({ ...p, on: true })) });
}

/** Cuts the found pauses that are still switched on, in one undo step. */
export function cutFoundPauses(clipId: string): void {
  const found = clipUiStore.getState().found;
  if (found?.clipId !== clipId) return;
  addSkips(clipId, 'history.cutPauses', found.pauses.filter((p) => p.on));
  setFoundPauses(null);
}

/** Cuts these words from the clip. */
export function cutWords(clipId: string, words: readonly Pick<Word, 'start' | 'end'>[]): void {
  const source = store().project?.source;
  const span = source ? wordsSpan(words, workingFrameRate(source)) : null;
  if (span) addSkips(clipId, 'history.cutWords', [span]);
}

/** Takes back the skip at source time `t`. */
export function restoreSkip(clipId: string, t: number): void {
  store().edit('history.restoreCut', (d) => {
    const clip = d.clips.find((c) => c.id === clipId);
    if (clip) clip.skips = withoutSkipAt(clip, t);
  });
}

export function restoreAllSkips(clipId: string): void {
  store().edit('history.restoreCuts', (d) => {
    const clip = d.clips.find((c) => c.id === clipId);
    if (clip) clip.skips = [];
  });
}
