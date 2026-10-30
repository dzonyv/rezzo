/**
 * The open clip's player, shared by the preview, the transport buttons and
 * the timeline. Only one clip is open, so there's one player at a time.
 */
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Size } from '../../../shared/framing.ts';
import { pauseEpisode, playbackStore } from '../player/playback.ts';
import type { ClipPlayer } from '../render/clip-player.ts';

interface ClipPlaybackState {
  /** Source seconds of the frame on screen. */
  time: number;
  playing: boolean;
  /** "preparing": FFmpeg is making the working file; "loading": reading it in. */
  status: 'preparing' | 'loading' | 'ready' | 'failed';
  /** 0..1 while preparing. */
  progress: number;
  error: string | null;
  /** The working file's picture size, for turning drags into framing. */
  sourceSize: Size | null;
}

export const clipPlaybackStore = createStore<ClipPlaybackState>()(() => ({
  time: 0,
  playing: false,
  status: 'preparing',
  progress: 0,
  error: null,
  sourceSize: null,
}));

export function useClipPlayback<T>(select: (s: ClipPlaybackState) => T): T {
  return useStore(clipPlaybackStore, select);
}

let player: ClipPlayer | null = null;

/** Hands over the current player (or none); the old one is disposed. */
export function setPlayer(next: ClipPlayer | null): void {
  if (player === next) return;
  player?.dispose();
  player = next;
  if (next) {
    next.onTime = (time, playing) => {
      clipPlaybackStore.setState({ time, playing });
      // Two things playing at once is never what anyone wants.
      if (playing) pauseEpisode();
    };
    clipPlaybackStore.setState({ time: next.currentTime, playing: next.isPlaying, sourceSize: next.size });
  } else {
    clipPlaybackStore.setState({ playing: false });
  }
}

export function currentPlayer(): ClipPlayer | null {
  return player;
}

export const seekClip = (time: number): void => player?.seek(time);
export const toggleClip = (): void => player?.toggle();
export const pauseClip = (): void => player?.pause();

// And the other way round: the episode starting pauses the clip.
playbackStore.subscribe((s, prev) => {
  if (s.playing && !prev.playing) pauseClip();
});
