/**
 * The episode player's state, shared with the transcript. While the video
 * plays, the time is read every animation frame so the highlighted word
 * keeps up with the speech.
 */
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

interface PlaybackState {
  time: number;
  playing: boolean;
}

export const playbackStore = createStore<PlaybackState>()(() => ({ time: 0, playing: false }));

export function usePlayback<T>(select: (s: PlaybackState) => T): T {
  return useStore(playbackStore, select);
}

let video: HTMLVideoElement | null = null;
let frame = 0;

function tick() {
  if (!video) return;
  playbackStore.setState({ time: video.currentTime });
  frame = video.paused ? 0 : requestAnimationFrame(tick);
}

const onPlay = () => {
  playbackStore.setState({ playing: true });
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(tick);
};
const onPause = () => {
  playbackStore.setState({ playing: false });
  tick();
};
// Only the time; while playing, the running loop carries on by itself.
const onSeeked = () => playbackStore.setState({ time: video?.currentTime ?? 0 });

/** Connects the <video> element; pass null when it goes away. */
export function attachVideo(el: HTMLVideoElement | null): void {
  if (video === el) return;
  if (video) {
    video.removeEventListener('play', onPlay);
    video.removeEventListener('pause', onPause);
    video.removeEventListener('seeked', onSeeked);
    cancelAnimationFrame(frame);
  }
  video = el;
  playbackStore.setState({ time: el?.currentTime ?? 0, playing: el ? !el.paused : false });
  if (el) {
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('seeked', onSeeked);
  }
}

export function seek(time: number, { play = false } = {}): void {
  if (!video) return;
  video.currentTime = time;
  playbackStore.setState({ time });
  if (play) void video.play();
}

export function togglePlay(): void {
  if (!video) return;
  if (video.paused) void video.play();
  else video.pause();
}
