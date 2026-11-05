/**
 * Video layers' sound for the preview: each layer's working file has its
 * file's audio, decoded once into an AudioBuffer and placed by
 * clipSoundPieces, as the export places it.
 */
import type { Asset } from '../../../shared/assets.ts';
import { clipSoundPieces, videoLayersOf } from '../../../shared/overlay-files.ts';
import type { Clip } from '../../../shared/project.ts';
import type { LayerSound } from './clip-player.ts';
import { workingFileBytes, type OverlayFile } from './overlay-files.ts';

/** Decoded sound by working file URL; null for a file without sound. */
const decoded = new Map<string, Promise<AudioBuffer | null>>();

function soundOf(url: string): Promise<AudioBuffer | null> {
  let held = decoded.get(url);
  if (!held) {
    held = workingFileBytes(url)
      // decodeAudioData takes the buffer over, and the picture's decoder still reads it: a copy.
      .then((bytes) => new OfflineAudioContext(2, 1, 48_000).decodeAudioData(bytes.slice(0)))
      .catch(() => null);
    decoded.set(url, held);
  }
  return held;
}

/**
 * The sound of `clip`'s video layers that have any, from their working
 * files in `files` (by layer id). Decoded sound no layer uses any more is
 * let go of.
 */
export async function layerSounds(clip: Clip, assets: readonly Asset[], files: ReadonlyMap<string, OverlayFile>): Promise<LayerSound[]> {
  const used = new Set<string>();
  const sounds = await Promise.all(
    videoLayersOf(clip, assets).map(async ({ layer, asset }): Promise<LayerSound | null> => {
      const file = files.get(layer.id);
      if (!asset.hasAudio || !file) return null;
      used.add(file.url);
      const pieces = clipSoundPieces(clip, layer, asset.duration);
      const buffer = pieces.length > 0 ? await soundOf(file.url) : null;
      if (!buffer) return null;
      return { buffer, volume: layer.volume, pieces: pieces.map((p) => ({ ...p, from: Math.max(0, p.from - file.start) })) };
    }),
  );
  for (const url of decoded.keys()) if (!used.has(url)) decoded.delete(url);
  return sounds.filter((s) => s !== null);
}
