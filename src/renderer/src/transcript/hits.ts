/**
 * Where the transcript search finds what's typed, in seconds, for the
 * episode strip to mark. The transcript keeps its own search; this is only
 * what it last found.
 */
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

interface HitsState {
  /** The start of each match, in the order of the transcript. */
  times: readonly number[];
  /** Which of them the transcript is showing; -1 with none. */
  current: number;
}

export const hitsStore = createStore<HitsState>()(() => ({ times: [], current: -1 }));

export function useHits<T>(select: (s: HitsState) => T): T {
  return useStore(hitsStore, select);
}
