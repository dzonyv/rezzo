/**
 * The files the open project's layers show, from the page's side: adding
 * an image, a video or an animation to a clip, finding a file that moved,
 * and which files couldn't be read.
 */
import i18n from 'i18next';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { AddAssetResult, LocateAssetResult } from '../../../shared/api.ts';
import type { Asset, AssetFile, AssetKind, AudioInfo, VideoInfo } from '../../../shared/assets.ts';
import type { Size } from '../../../shared/framing.ts';
import type { LottieInfo } from '../../../shared/lottie.ts';
import { decodeImage, keepImage, keepOnlyImages } from '../render/images.ts';
import { keepOnlyLotties } from '../render/lottie.ts';
import { keepOnlySoundFiles } from '../render/sound-files.ts';
import { notify } from '../ui/prompts.ts';
import { addImageLayer, addLottieLayer, addSoundFile, addVideoLayer, replaceImage, replaceLottie, replaceSoundFile, replaceVideo } from './layers.ts';
import { projectStore } from './store.ts';
import { MAX_VIDEO_LAYERS } from '../../../shared/overlay-files.ts';

/** Asset ids whose files couldn't be read, so the editor can offer to find them. */
export const missingAssetsStore = createStore<{ missing: ReadonlySet<string> }>()(() => ({ missing: new Set() }));

export function markMissing(id: string, missing: boolean): void {
  const now = missingAssetsStore.getState().missing;
  if (now.has(id) === missing) return;
  const next = new Set(now);
  if (missing) next.add(id);
  else next.delete(id);
  missingAssetsStore.setState({ missing: next });
}

export function useAssetMissing(id: string | undefined): boolean {
  return useStore(missingAssetsStore, (s) => id !== undefined && s.missing.has(id));
}

projectStore.subscribe((s, prev) => {
  // A different project starts with nothing known to be missing.
  if (s.project?.id !== prev.project?.id) missingAssetsStore.setState({ missing: new Set() });
  // Images and animations no layer uses any more (deleted, replaced, another project) don't stay in memory.
  if (s.project?.assets !== prev.project?.assets) {
    keepOnlyImages(s.project?.assets ?? []);
    keepOnlyLotties(s.project?.assets ?? []);
    keepOnlySoundFiles(s.project?.assets ?? []);
  }
});

type Picked =
  | { kind: 'image'; file: AssetFile; size: Size }
  | { kind: 'video'; file: AssetFile; video: VideoInfo }
  | { kind: 'lottie'; file: AssetFile; lottie: LottieInfo }
  | { kind: 'audio'; file: AssetFile; audio: AudioInfo };

/** Why a picked file can't be used, in words for its kind. */
function refuse(kind: AssetKind, error: 'unreadable' | 'too-large' | 'too-long' | 'different-file' | 'external-images'): null {
  // Only an animation can need files beside it.
  const reason = kind !== 'lottie' && error === 'external-images' ? 'unreadable' : error;
  if (reason === 'different-file') notify('error', i18n.t('layers.errors.different-file'));
  else if (kind === 'audio') notify('error', i18n.t(`layers.errors.audio.${reason === 'external-images' ? 'unreadable' : reason}`));
  else if (reason === 'too-long') notify('error', i18n.t('layers.errors.unreadable'));
  else if (kind === 'lottie') notify('error', i18n.t(`layers.errors.lottie.${reason}`));
  else if (reason !== 'external-images') notify('error', i18n.t(kind === 'video' ? `layers.errors.video.${reason}` : `layers.errors.${reason}`));
  return null;
}

/** A picked file of `kind`: an image decoded, a video or an animation as the main process read it; null (after saying why) when it can't be used. */
async function readPicked(kind: AssetKind, result: AddAssetResult | LocateAssetResult | null): Promise<Picked | null> {
  if (!result) return null;
  if (!result.ok) return refuse(kind, result.error);
  if (kind === 'video') return result.video ? { kind, file: result.file, video: result.video } : refuse(kind, 'unreadable');
  if (kind === 'lottie') return result.lottie ? { kind, file: result.file, lottie: result.lottie } : refuse(kind, 'unreadable');
  if (kind === 'audio') return result.audio ? { kind, file: result.file, audio: result.audio } : refuse(kind, 'unreadable');
  try {
    const image = await decodeImage(result.url);
    keepImage(result.file, image);
    return { kind, file: result.file, size: { width: image.width, height: image.height } };
  } catch {
    notify('error', i18n.t('layers.errors.unreadable'));
    return null;
  }
}

/** Asks for an image, a video, an animation or a sound file and puts it in the clip from `time` on. Returns the new layer's id. */
export async function addLayerFile(kind: AssetKind, clipId: string, time: number): Promise<string | null> {
  const picked = await readPicked(kind, await window.rezzo.invoke('asset:add', kind));
  if (!picked) return null;
  if (picked.kind === 'image') return addImageLayer(clipId, picked.file, picked.size, time);
  if (picked.kind === 'audio') return addSoundFile(clipId, picked.file, picked.audio, time);
  if (picked.kind === 'lottie') return addLottieLayer(clipId, picked.file, picked.lottie, time);
  const added = addVideoLayer(clipId, picked.file, picked.video, time);
  if (added !== 'too-many') return added;
  notify('error', i18n.t('layers.errors.tooManyVideos', { count: MAX_VIDEO_LAYERS }));
  return null;
}

/** Asks for another file of the same kind for the layer. */
export async function changeLayerFile(clipId: string, layerId: string, kind: AssetKind): Promise<void> {
  const picked = await readPicked(kind, await window.rezzo.invoke('asset:add', kind));
  if (picked?.kind === 'image') replaceImage(clipId, layerId, picked.file, picked.size);
  else if (picked?.kind === 'video') replaceVideo(clipId, layerId, picked.file, picked.video);
  else if (picked?.kind === 'lottie') replaceLottie(clipId, layerId, picked.file, picked.lottie);
  else if (picked?.kind === 'audio') replaceSoundFile(clipId, layerId, picked.file, picked.audio);
}

/** Asks where a file went; the project then uses it from there. */
export async function locateAsset(asset: Asset): Promise<void> {
  const picked = await readPicked(asset.kind, await window.rezzo.invoke('asset:locate', asset.kind, asset));
  if (!picked) return;
  // Moving the file isn't an edit to undo, as for the source video: undo would point back where it isn't.
  projectStore.getState().replace((d) => {
    const a = d.assets.find((x) => x.id === asset.id);
    if (a) Object.assign(a, { path: picked.file.path, name: picked.file.name, size: picked.file.size });
  });
  markMissing(asset.id, false);
}
