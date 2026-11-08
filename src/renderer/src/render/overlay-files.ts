/**
 * The working files of the open clip's video layers, from the page's side:
 * asks the main process for each layer's file, follows the conversion's
 * progress (the timeline shows it on the layer's bar) and keeps what came
 * back for the renderer. The files' bytes are fetched once and shared by
 * the picture (render/layer-frames.ts) and the sound (render/layer-sound.ts).
 */
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Asset, VideoAsset } from '../../../shared/assets.ts';
import type { FrameRate } from '../../../shared/frames.ts';
import { overlayRange, videoLayersOf, type OverlayLayout } from '../../../shared/overlay-files.ts';
import type { Clip, OverlayLayer } from '../../../shared/project.ts';
import { withinFrames } from '../../../shared/working.ts';
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

/**
 * Edits that keep changing the part of a long file a layer needs (dragging
 * its start in the video, trimming it) settle this long before a new file
 * is asked for, so a drag doesn't start a conversion for every step.
 */
const SETTLE_MS = 400;

/** By layer id. */
export const overlayFilesStore = createStore<{ files: ReadonlyMap<string, OverlayFileState> }>()(() => ({ files: new Map() }));

export const useOverlayFile = (layerId: string): OverlayFileState | undefined => useStore(overlayFilesStore, (s) => s.files.get(layerId));

function setState(layerId: string, state: OverlayFileState | null): void {
  const files = new Map(overlayFilesStore.getState().files);
  if (state) files.set(layerId, state);
  else files.delete(layerId);
  overlayFilesStore.setState({ files });
}

/**
 * Asks the main process for the working file of `layer`'s file at `rate`.
 * Null: cancelled with overlay:cancel.
 */
export async function requestOverlayFile(layer: OverlayLayer, asset: VideoAsset, rate: FrameRate, requestId: string = crypto.randomUUID()): Promise<OverlayFileState | null> {
  try {
    const result = await window.rezzo.invoke('overlay:prepare', asset, overlayRange(layer, asset), rate, requestId);
    if (result.ok) return { status: 'ready', file: { assetId: asset.id, url: result.url, start: result.start, end: result.end, frameRate: result.frameRate, layout: result.layout } };
    if (result.error === 'failed') return { status: 'failed', detail: result.detail };
    return result.error === 'missing' ? { status: 'missing' } : null;
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

/** A working file was asked for but isn't there (pruned from the cache, deleted by hand). */
export class WorkingFileGoneError extends Error {}

/** Working files' bytes by URL, fetched once while a layer of the open clip uses them. */
const bytes = new Map<string, Promise<ArrayBuffer>>();

/** The bytes of a video layer's working file. Copy them before handing them to anything that takes them over. */
export function workingFileBytes(url: string): Promise<ArrayBuffer> {
  let held = bytes.get(url);
  if (!held) {
    held = fetch(url).then((r) => {
      if (r.status === 404) throw new WorkingFileGoneError(`a video layer's working file is gone: ${url}`);
      if (!r.ok) throw new Error(`loading a video layer's working file failed: ${r.status}`);
      return r.arrayBuffer();
    });
    const fetched = held;
    // A failed fetch isn't kept, so asking again tries again.
    fetched.catch(() => {
      if (bytes.get(url) === fetched) bytes.delete(url);
    });
    bytes.set(url, held);
  }
  return held;
}

/** What each layer last asked for, so an unchanged layer isn't asked again and a stale answer is dropped. */
const wanted = new Map<string, string>();
/** Each layer's request waiting to settle or under way. */
const pending = new Map<string, { requestId: string; timer: number }>();
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

/** Drops the layer's request, stopping its conversion if nothing else waits for it. */
function cancel(layerId: string): void {
  const p = pending.get(layerId);
  if (!p) return;
  clearTimeout(p.timer);
  progressOf.delete(p.requestId);
  pending.delete(layerId);
  void window.rezzo.invoke('overlay:cancel', p.requestId);
}

/**
 * Makes sure every video layer of `clip` has a working file holding what it
 * shows, at the clip's frame rate. A file that still covers a layer after
 * an edit is kept; layers that are gone are forgotten.
 */
export function prepareOverlayFiles(clip: Clip, assets: readonly Asset[], rate: FrameRate): void {
  listen();
  const present = new Set<string>();
  for (const { layer, asset } of videoLayersOf(clip, assets)) {
    present.add(layer.id);
    const range = overlayRange(layer, asset);
    const needed = withinFrames(range, asset.duration, rate);
    const now = overlayFilesStore.getState().files.get(layer.id);
    const covered = now?.status === 'ready' && now.file.assetId === asset.id && now.file.frameRate.join() === rate.join() && now.file.start <= needed.start + 1e-6 && now.file.end >= needed.end - 1e-6;
    const key = [asset.id, asset.path, rate.join('/'), range.start, range.end].join('|');
    if (covered) {
      // Back inside the file it has: whatever was asked for meanwhile isn't needed.
      if (wanted.get(layer.id) !== key) cancel(layer.id);
      wanted.set(layer.id, key);
      continue;
    }
    if (wanted.get(layer.id) === key) continue;
    wanted.set(layer.id, key);
    cancel(layer.id);

    const requestId = crypto.randomUUID();
    setState(layer.id, { status: 'preparing', progress: 0 });
    const ask = () => {
      progressOf.set(requestId, layer.id);
      void requestOverlayFile(layer, asset, rate, requestId).then((state) => {
        progressOf.delete(requestId);
        if (pending.get(layer.id)?.requestId === requestId) pending.delete(layer.id);
        // A newer request for the layer replaced this one. A missing file is
        // asked for again once it's found, since its path is part of the key.
        if (state === null || wanted.get(layer.id) !== key) return;
        markMissing(asset.id, state.status === 'missing');
        setState(layer.id, state);
      });
    };
    // A layer's first file is asked for at once; a change to one it had waits for the edit to settle.
    pending.set(layer.id, { requestId, timer: window.setTimeout(ask, now ? SETTLE_MS : 0) });
  }
  for (const id of new Set([...overlayFilesStore.getState().files.keys(), ...pending.keys()])) {
    if (present.has(id)) continue;
    cancel(id);
    wanted.delete(id);
    setState(id, null);
  }
  const used = new Set(Array.from(readyFiles(overlayFilesStore.getState().files).values(), (f) => f.url));
  for (const url of bytes.keys()) if (!used.has(url)) bytes.delete(url);
}

/**
 * Lets layers whose file failed or went missing ask again on the next
 * prepareOverlayFiles (a clip opened again, a file found where it went).
 */
export function retryFailedOverlayFiles(): void {
  for (const [id, state] of overlayFilesStore.getState().files) {
    if (state.status === 'failed' || state.status === 'missing') wanted.delete(id);
  }
}

/** Forgets the layer's file (its working file vanished), so the next prepareOverlayFiles makes it again. */
export function forgetOverlayFile(layerId: string): void {
  cancel(layerId);
  wanted.delete(layerId);
  setState(layerId, null);
}
