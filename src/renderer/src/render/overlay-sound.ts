/**
 * Video layers' sound for the preview: each layer's working file has its
 * file's audio, decoded once into an AudioBuffer and placed by
 * overlaySoundPieces, as the export places it.
 */
import type { Asset } from '../../../shared/assets.ts';
import { overlaySoundPieces } from '../../../shared/overlay-files.ts';
import type { Clip } from '../../../shared/project.ts';
import type { LayerSound } from './clip-player.ts';
import type { OverlayFile } from './overlay-files.ts';

/** Decoded sound by working file URL; null for a file without sound. */
const decoded = new Map<string, Promise<AudioBuffer | null>>();

function soundOf(url: string): Promise<AudioBuffer | null> {
  let held = decoded.get(url);
  if (!held) {
    held = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`loading a video layer's sound failed: ${r.status}`))))
      .then((bytes) => new OfflineAudioContext(2, 1, 48_000).decodeAudioData(bytes))
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
    clip.layers.map(async (layer): Promise<LayerSound | null> => {
      if (layer.kind !== 'overlay') return null;
      const asset = assets.find((a) => a.id === layer.assetId);
      const file = files.get(layer.id);
      if (asset?.kind !== 'video' || !asset.hasAudio || !file) return null;
      used.add(file.url);
      const pieces = overlaySoundPieces(layer, asset.duration, clip);
      const buffer = pieces.length > 0 ? await soundOf(file.url) : null;
      if (!buffer) return null;
      return { buffer, volume: layer.volume, pieces: pieces.map((p) => ({ ...p, from: Math.max(0, p.from - file.start) })) };
    }),
  );
  for (const url of decoded.keys()) if (!used.has(url)) decoded.delete(url);
  return sounds.filter((s) => s !== null);
}
