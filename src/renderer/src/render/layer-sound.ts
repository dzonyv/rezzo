/**
 * The layers' sound for the preview. A video layer's comes from its
 * working file, decoded once into an AudioBuffer; a sound layer's from its
 * file or the library (render/sound-files.ts). Both are placed by
 * clipSoundPieces and shaped by shared/sound-mix.ts, as the export does.
 */
import type { Asset } from '../../../shared/assets.ts';
import { clipSoundPieces, videoLayersOf } from '../../../shared/overlay-files.ts';
import type { Clip } from '../../../shared/project.ts';
import { playedSound, soundLayersOf } from '../../../shared/sound-mix.ts';
import type { LayerSound } from './clip-player.ts';
import { workingFileBytes, type OverlayFile } from './overlay-files.ts';
import { loadLibrarySound, loadSoundFile } from './sound-files.ts';

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
 * files in `files` (by layer id), and of its sound layers. Decoded working
 * file sound no layer uses any more is let go of. A sound layer whose file
 * can't be read is left out; `onFile` hears whether each file was there.
 */
export async function layerSounds(
  clip: Clip,
  assets: readonly Asset[],
  files: ReadonlyMap<string, OverlayFile>,
  onFile: (asset: Asset, there: boolean) => void = () => {},
): Promise<LayerSound[]> {
  const used = new Set<string>();
  const videos = videoLayersOf(clip, assets).map(async ({ layer, asset }): Promise<LayerSound | null> => {
    const file = files.get(layer.id);
    if (!asset.hasAudio || !file) return null;
    used.add(file.url);
    const played = playedSound(clipSoundPieces(clip, layer, asset.duration), asset.duration, layer.volume);
    const buffer = played ? await soundOf(file.url) : null;
    if (!played || !buffer) return null;
    return { buffer, played: { ...played, from: Math.max(0, played.from - file.start) } };
  });
  const sounds = soundLayersOf(clip, assets).map(async ({ layer, duration, asset }): Promise<LayerSound | null> => {
    const played = playedSound(clipSoundPieces(clip, layer, duration), duration, layer.volume, layer.fadeIn, layer.fadeOut);
    if (!played) return null;
    try {
      const buffer = 'library' in layer.sound ? await loadLibrarySound(layer.sound.library) : await loadSoundFile(asset!);
      if (asset) onFile(asset, true);
      return { buffer, played };
    } catch {
      if (asset) onFile(asset, false);
      return null;
    }
  });
  const all = await Promise.all([...videos, ...sounds]);
  for (const url of decoded.keys()) if (!used.has(url)) decoded.delete(url);
  return all.filter((s) => s !== null);
}
