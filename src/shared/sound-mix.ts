/**
 * How loud a layer's sound is over time: its volume, faded in from silence
 * where it starts playing and out to silence where it stops. The preview
 * (Web Audio ramps) and the export (FFmpeg's afade, also linear) both use
 * these numbers, so they sound the same.
 */
import type { Asset, AudioAsset } from './assets.ts';
import type { SoundPiece } from './overlay-files.ts';
import { soundLayers, type Clip, type SoundLayer } from './project.ts';
import { SOUNDS } from './sounds.ts';

/** A layer's sound as it plays: from `at` for `length` seconds (output time), fully up after `fadeIn` and down to silence over the last `fadeOut`. */
export interface SoundEnvelope {
  at: number;
  length: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

/**
 * The envelope of a sound played as `pieces` (one after another, as
 * overlaySoundPieces makes them). The fades are counted from where the
 * sound really starts and stops, which is earlier than the layer's end when
 * the file runs out, and each takes at most half of it.
 */
export function envelopeOf(pieces: readonly SoundPiece[], volume: number, fadeIn = 0, fadeOut = 0): SoundEnvelope | null {
  const first = pieces[0];
  const last = pieces.at(-1);
  if (!first || !last) return null;
  const length = last.at + last.duration - first.at;
  const half = length / 2;
  return { at: first.at, length, volume, fadeIn: Math.min(fadeIn, half), fadeOut: Math.min(fadeOut, half) };
}

/** The gain at output time `t`: 0 outside the sound, the volume between the fades, a straight line along them. */
export function gainAt(e: SoundEnvelope, t: number): number {
  const into = t - e.at;
  const left = e.at + e.length - t;
  if (into < 0 || left < 0) return 0;
  let g = 1;
  if (e.fadeIn > 0 && into < e.fadeIn) g = Math.min(g, into / e.fadeIn);
  if (e.fadeOut > 0 && left < e.fadeOut) g = Math.min(g, left / e.fadeOut);
  return e.volume * g;
}

/**
 * The gain's corners from output time `from` on: the gain goes in a
 * straight line from each point to the next, and stays at the last one.
 * What Web Audio's linearRampToValueAtTime needs.
 */
export function gainPoints(e: SoundEnvelope, from: number): { t: number; gain: number }[] {
  const end = e.at + e.length;
  const corners = [e.at, e.at + e.fadeIn, end - e.fadeOut, end];
  const start = Math.max(from, e.at);
  if (start >= end) return [];
  const times = [start, ...corners.filter((t) => t > start)];
  return times.map((t) => ({ t, gain: gainAt(e, t) }));
}

/**
 * A layer's sound as it plays in a clip: its envelope, and from `from`
 * seconds into its file on. With `loop` it starts over every `period`
 * seconds: the file's length as the picture counts it, so a looping video
 * layer's sound stays with its picture.
 */
export interface PlayedSound {
  envelope: SoundEnvelope;
  from: number;
  loop: boolean;
  period: number;
}

/** How `pieces` (from clipSoundPieces for a file `duration` long) play, at `volume` with these fades; null when nothing plays. */
export function playedSound(pieces: readonly SoundPiece[], duration: number, volume: number, fadeIn = 0, fadeOut = 0): PlayedSound | null {
  const envelope = envelopeOf(pieces, volume, fadeIn, fadeOut);
  return envelope && { envelope, from: pieces[0]!.from, loop: pieces.length > 1, period: duration };
}

/** A sound layer's file among `assets`, or null for a sound from the library (or a file that isn't there). */
export function soundAsset(layer: SoundLayer, assets: readonly Asset[]): AudioAsset | null {
  if ('library' in layer.sound) return null;
  const { assetId } = layer.sound;
  const asset = assets.find((a) => a.id === assetId);
  return asset?.kind === 'audio' ? asset : null;
}

/** Seconds of sound in a sound layer's file, or null when its file isn't among `assets`. */
export function soundDuration(layer: SoundLayer, assets: readonly Asset[]): number | null {
  if ('library' in layer.sound) return SOUNDS[layer.sound.library].seconds;
  return soundAsset(layer, assets)?.duration ?? null;
}

/**
 * Roughly how long a sound layer plays, in source seconds: its whole time
 * when it loops, else until its file runs out. For drawing it; skips inside
 * it aren't counted.
 */
export function playedLength(layer: Pick<SoundLayer, 'start' | 'end' | 'offset' | 'loop'>, duration: number): number {
  const length = layer.end - layer.start;
  return layer.loop ? length : Math.max(0, Math.min(length, duration - layer.offset));
}

export interface HeardSoundLayer {
  layer: SoundLayer;
  /** Seconds of sound in its file. */
  duration: number;
  /** Its file among the project's assets, or null for a sound from the library. */
  asset: AudioAsset | null;
}

/**
 * The clip's sound layers with the length of what each plays: a library
 * sound's, or its file's from the project's assets. Layers whose file
 * isn't among them are left out.
 */
export function soundLayersOf(clip: Pick<Clip, 'layers'>, assets: readonly Asset[]): HeardSoundLayer[] {
  return soundLayers(clip).flatMap((layer): HeardSoundLayer[] => {
    const duration = soundDuration(layer, assets);
    return duration === null ? [] : [{ layer, duration, asset: soundAsset(layer, assets) }];
  });
}
