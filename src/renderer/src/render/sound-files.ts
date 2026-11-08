/**
 * Sound layers' files decoded for the preview: the library's sounds (read
 * once per run) and the project's sound files (read once per file, like
 * images). Also how loud each is along the way, for the timeline's
 * waveforms.
 */
import { useEffect, useState } from 'react';
import type { AssetFile, AudioAsset } from '../../../shared/assets.ts';
import type { SoundName } from '../../../shared/sounds.ts';
import { FileCache } from './file-cache.ts';

/** Decodes the sound file at `url` at the rate the preview plays at. */
async function decodeSound(url: string): Promise<AudioBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`reading the sound failed: ${response.status}`);
  return new OfflineAudioContext(2, 1, 48_000).decodeAudioData(await response.arrayBuffer());
}

const files = new FileCache<AudioBuffer>(decodeSound);
const library = new Map<SoundName, Promise<AudioBuffer>>();

/** A sound from the library, decoded. */
export function loadLibrarySound(name: SoundName): Promise<AudioBuffer> {
  let loading = library.get(name);
  if (!loading) {
    loading = window.rezzo.invoke('sound:url', name).then(decodeSound);
    loading.catch(() => library.delete(name));
    library.set(name, loading);
  }
  return loading;
}

/** One of the project's sound files, decoded; rejects when it isn't there any more (see FileCache.load). */
export const loadSoundFile = (asset: AudioAsset): Promise<AudioBuffer> => files.load(asset);

/** Lets go of every sound file except those of `assets` (the open project's). */
export const keepOnlySoundFiles = (assets: readonly AssetFile[]): void => files.keepOnly(assets);

/** Loudness values per second in Waveform. */
export const WAVEFORM_PER_SECOND = 50;

/** The highest sample (0..1) in each 1/WAVEFORM_PER_SECOND s of a sound. */
export type Waveform = Float32Array;

const waveforms = new WeakMap<AudioBuffer, Waveform>();

function waveformOf(buffer: AudioBuffer): Waveform {
  let w = waveforms.get(buffer);
  if (w) return w;
  const step = buffer.sampleRate / WAVEFORM_PER_SECOND;
  w = new Float32Array(Math.ceil(buffer.length / step));
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const b = Math.floor(i / step);
      const v = Math.abs(data[i]!);
      if (v > w[b]!) w[b] = v;
    }
  }
  waveforms.set(buffer, w);
  return w;
}

/** The waveform of a sound once it's decoded; null until then, or when it can't be read. */
export function useWaveform(load: (() => Promise<AudioBuffer>) | null, key: string): Waveform | null {
  const [state, setState] = useState<{ key: string; waveform: Waveform | null }>({ key: '', waveform: null });
  useEffect(() => {
    if (!load) return;
    let current = true;
    load().then(
      (buffer) => current && setState({ key, waveform: waveformOf(buffer) }),
      () => current && setState({ key, waveform: null }),
    );
    return () => {
      current = false;
    };
    // `key` names what `load` reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state.waveform : null;
}

let listening: { context: AudioContext; node: AudioBufferSourceNode } | null = null;

/** Plays a sound once, to hear it before adding it; stops the one playing before. `onEnd` hears when it stops. */
export function listen(buffer: AudioBuffer, onEnd: () => void): void {
  stopListening();
  const context = new AudioContext({ latencyHint: 'interactive' });
  const node = context.createBufferSource();
  node.buffer = buffer;
  node.connect(context.destination);
  const now = { context, node };
  node.onended = () => {
    if (listening === now) listening = null;
    void context.close();
    onEnd();
  };
  node.start();
  listening = now;
}

export function stopListening(): void {
  listening?.node.stop();
}
