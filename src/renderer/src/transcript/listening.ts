/**
 * The time being listened to: the episode player's or the open clip's,
 * whichever moved last. The transcript highlights the word at this time,
 * and corrections play and seek through the same player.
 */
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { clipPlaybackStore, currentPlayer, pauseClip } from '../clip/playback.ts';
import { pauseEpisode, playbackStore, seek } from '../player/playback.ts';

interface ListeningState {
  time: number;
  playing: boolean;
  from: 'episode' | 'clip';
}

export const listeningStore = createStore<ListeningState>()(() => ({ time: 0, playing: false, from: 'episode' }));

export function useListening<T>(select: (s: ListeningState) => T): T {
  return useStore(listeningStore, select);
}

playbackStore.subscribe((s, prev) => {
  if (s.time !== prev.time || s.playing !== prev.playing) listeningStore.setState({ time: s.time, playing: s.playing, from: 'episode' });
});
clipPlaybackStore.subscribe((s, prev) => {
  if (s.time !== prev.time || s.playing !== prev.playing) listeningStore.setState({ time: s.time, playing: s.playing, from: 'clip' });
});

/** The open clip's player, when `time` is inside its clip and that player was the last one used. */
function clipPlayerFor(time: number) {
  const player = currentPlayer();
  if (!player || listeningStore.getState().from !== 'clip') return null;
  const { start, end } = player.clipRange;
  return time >= start && time < end ? player : null;
}

/** Shows `time` without playing, in the player in use. */
export function seekPaused(time: number): void {
  const clip = clipPlayerFor(time);
  if (clip) {
    clip.pause();
    clip.seek(time);
  } else {
    pauseClip();
    pauseEpisode();
    seek(time);
  }
}

/** Plays from a little before `time`, to hear a word in context. */
export function playAround(time: number): void {
  const from = Math.max(0, time - 1);
  const clip = clipPlayerFor(time);
  if (clip) {
    clip.seek(from);
    clip.play();
  } else {
    seek(from, { play: true });
  }
}
