/**
 * The files the open project's layers show, from the page's side: adding
 * an image to a clip, finding a file that moved, and which files couldn't
 * be read.
 */
import i18n from 'i18next';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { AddAssetResult, LocateAssetResult } from '../../../shared/api.ts';
import type { Asset, AssetFile } from '../../../shared/assets.ts';
import type { Size } from '../../../shared/framing.ts';
import { decodeImage, keepImage } from '../render/images.ts';
import { notify } from '../ui/prompts.ts';
import { addImageLayer, replaceImage } from './layers.ts';
import { projectStore } from './store.ts';

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

// A different project starts with nothing known to be missing.
projectStore.subscribe((s, prev) => {
  if (s.project?.id !== prev.project?.id) missingAssetsStore.setState({ missing: new Set() });
});

/** The picked image, decoded; null (after saying why) when it can't be used. */
async function readPicked(result: AddAssetResult | LocateAssetResult | null): Promise<{ file: AssetFile; size: Size } | null> {
  if (!result) return null;
  if (!result.ok) {
    notify('error', i18n.t(`layers.errors.${result.error}`));
    return null;
  }
  try {
    const image = await decodeImage(result.url);
    keepImage(result.file, image);
    return { file: result.file, size: { width: image.width, height: image.height } };
  } catch {
    notify('error', i18n.t('layers.errors.unreadable'));
    return null;
  }
}

/** Asks for an image and puts it in the clip from `time` on. Returns the new layer's id. */
export async function addImage(clipId: string, time: number): Promise<string | null> {
  const picked = await readPicked(await window.rezzo.invoke('asset:add', 'image'));
  return picked ? addImageLayer(clipId, picked.file, picked.size, time) : null;
}

/** Asks for another image for the layer. */
export async function changeImage(clipId: string, layerId: string): Promise<void> {
  const picked = await readPicked(await window.rezzo.invoke('asset:add', 'image'));
  if (picked) replaceImage(clipId, layerId, picked.file, picked.size);
}

/** Asks where a file went; the project then uses it from there. */
export async function locateAsset(asset: Asset): Promise<void> {
  const picked = await readPicked(await window.rezzo.invoke('asset:locate', asset.kind, asset));
  if (!picked) return;
  projectStore.getState().edit('history.locateFile', (d) => {
    const a = d.assets.find((x) => x.id === asset.id);
    if (a) Object.assign(a, { path: picked.file.path, name: picked.file.name, size: picked.file.size });
  });
  markMissing(asset.id, false);
}
