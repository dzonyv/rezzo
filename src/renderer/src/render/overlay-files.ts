/**
 * The working files of the open clip's video layers, from the page's side:
 * asks the main process for each layer's file, follows the conversion's
 * progress (the timeline shows it on the layer's bar) and keeps what came
 * back for the renderer.
 */
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Asset, VideoAsset } from '../../../shared/assets.ts';
import type { FrameRate } from '../../../shared/frames.ts';
import { overlayRange, type OverlayLayout } from '../../../shared/overlay-files.ts';
import type { Clip, OverlayLayer } from '../../../shared/project.ts';
import { markMissing } from '../project/assets.ts';

/** A video layer's working file: frame 0 is at `start` seconds of the layer's file. */
export interface OverlayFile {
  assetId: string;
  url: string;
  start: number;
  end: number;
  frameRate: FrameRate;
  layout: OverlayLayout;
}

export type OverlayFileState =
  | { status: 'preparing'; progress: number }
  | { status: 'ready'; file: OverlayFile }
  | { status: 'missing' }
  | { status: 'failed'; detail: string };

/** By layer id. */
export const overlayFilesStore = createStore<{ files: ReadonlyMap<string, OverlayFileState> }>()(() => ({ files: new Map() }));

export const useOverlayFile = (layerId: string): OverlayFileState | undefined => useStore(overlayFilesStore, (s) => s.files.get(layerId));

function setState(layerId: string, state: OverlayFileState | null): void {
  const files = new Map(overlayFilesStore.getState().files);
  if (state) files.set(layerId, state);
  else files.delete(layerId);
  overlayFilesStore.setState({ files });
}

/** Asks the main process for the working file of `layer`'s file at `rate`. */
export async function requestOverlayFile(layer: OverlayLayer, asset: VideoAsset, rate: FrameRate, requestId: string = crypto.randomUUID()): Promise<OverlayFileState> {
  try {
    const result = await window.rezzo.invoke('overlay:prepare', asset, overlayRange(layer, asset), rate, requestId);
    if (result.ok) return { status: 'ready', file: { assetId: asset.id, url: result.url, start: result.start, end: result.end, frameRate: result.frameRate, layout: result.layout } };
    if (result.error === 'missing') return { status: 'missing' };
    return { status: 'failed', detail: result.detail };
  } catch (e) {
    return { status: 'failed', detail: e instanceof Error ? e.message : String(e) };
  }
}

/** The ready files of the layers in `files`, by layer id: what the renderer draws from. */
export function readyFiles(files: ReadonlyMap<string, OverlayFileState>): Map<string, OverlayFile> {
  const ready = new Map<string, OverlayFile>();
  for (const [id, state] of files) if (state.status === 'ready') ready.set(id, state.file);
  return ready;
}

/** What each layer last asked for, so an unchanged layer isn't asked again and a stale answer is dropped. */
const wanted = new Map<string, string>();
/** Request id -> layer id, for progress events. */
const progressOf = new Map<string, string>();

let listening = false;
function listen(): void {
  if (listening) return;
  listening = true;
  window.rezzo.on('overlay:prepare-progress', ({ requestId, fraction }) => {
    const layerId = progressOf.get(requestId);
    const now = layerId && overlayFilesStore.getState().files.get(layerId);
    if (layerId && now && now.status === 'preparing') setState(layerId, { status: 'preparing', progress: fraction });
  });
}

/**
 * Makes sure every video layer of `clip` has a working file holding what it
 * shows, at the clip's frame rate. A file that still covers a layer after
 * an edit is kept; layers that are gone are forgotten.
 */
export function prepareOverlayFiles(clip: Clip, assets: readonly Asset[], rate: FrameRate): void {
  listen();
  const present = new Set<string>();
  for (const layer of clip.layers) {
    if (layer.kind !== 'overlay') continue;
    const asset = assets.find((a) => a.id === layer.assetId);
    if (asset?.kind !== 'video') continue;
    present.add(layer.id);
    const range = overlayRange(layer, asset);
    const now = overlayFilesStore.getState().files.get(layer.id);
    if (now?.status === 'ready' && now.file.assetId === asset.id && now.file.frameRate.join() === rate.join() && now.file.start <= range.start + 1e-6 && now.file.end >= range.end - 1e-6) {
      continue;
    }
    const key = [asset.id, asset.path, rate.join('/'), range.start, range.end].join('|');
    if (wanted.get(layer.id) === key) continue;
    wanted.set(layer.id, key);

    const requestId = crypto.randomUUID();
    progressOf.set(requestId, layer.id);
    setState(layer.id, { status: 'preparing', progress: 0 });
    void requestOverlayFile(layer, asset, rate, requestId).then((state) => {
      progressOf.delete(requestId);
      // A newer request for the layer replaced this one. A missing file is
      // asked for again once it's found, since its path is part of the key.
      if (wanted.get(layer.id) !== key) return;
      markMissing(asset.id, state.status === 'missing');
      setState(layer.id, state);
    });
  }
  for (const id of overlayFilesStore.getState().files.keys()) {
    if (present.has(id)) continue;
    wanted.delete(id);
    setState(id, null);
  }
}
