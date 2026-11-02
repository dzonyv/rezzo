/**
 * Edits to the layers over a clip's picture: adding images and videos, moving and
 * trimming them in time, stacking them, placing them and animating them.
 * Placement works like framing (see project/framing.ts): while the
 * transform has one keyframe an edit changes it for the layer's whole time.
 */
import { current, type Draft } from 'immer';
import type { AssetFile, VideoInfo } from '../../../shared/assets.ts';
import { DEFAULT_CHROMA_KEY, type ChromaKey } from '../../../shared/chroma-key.ts';
import { editAt, OUTPUT, removeKey, setKey, valueAt, type Size } from '../../../shared/framing.ts';
import { fps, frameAt, timeOfFrame } from '../../../shared/frames.ts';
import { clampTransform, DEFAULT_MOTION, type Motion, type Transform } from '../../../shared/motion.ts';
import { videoLayersOverLimit } from '../../../shared/overlay-files.ts';
import { isTimed, type Clip, type OverlayLayer, type Project, type TimedLayer } from '../../../shared/project.ts';
import { sourceRate } from './framing.ts';
import { projectStore, type EditLabel } from './store.ts';

/** A new image shows this long, or to the end of the clip. */
export const NEW_LAYER_SECONDS = 3;
/** A new image is this wide (a share of the output), unless that makes it too tall. */
const NEW_LAYER_WIDTH = 0.6;
const NEW_LAYER_MAX_HEIGHT = 0.5;

const store = () => projectStore.getState();

function editClip(clipId: string, label: EditLabel, recipe: (clip: Draft<Clip>, project: Draft<Project>) => void): void {
  store().edit(label, (d) => {
    const clip = d.clips.find((c) => c.id === clipId);
    if (clip) recipe(clip, d);
  });
}

function editLayer(clipId: string, layerId: string, label: EditLabel, recipe: (layer: Draft<TimedLayer>, clip: Draft<Clip>) => void): void {
  editClip(clipId, label, (clip) => {
    const layer = clip.layers.find((l) => l.id === layerId);
    if (layer && isTimed(layer)) recipe(layer, clip);
  });
}

/** Drops assets no layer uses any more, in the same edit that stopped using them. */
function pruneAssets(d: Draft<Project>): void {
  const used = new Set(d.clips.flatMap((c) => c.layers.filter(isTimed).map((l) => l.assetId)));
  d.assets = d.assets.filter((a) => used.has(a.id));
}

/** Frame times inside the clip: [first, last frame start]. */
function clipFrames(clip: Pick<Clip, 'start' | 'end'>) {
  const rate = sourceRate();
  return { rate, first: frameAt(clip.start, rate), end: frameAt(clip.end, rate) };
}

/** The scale that makes a picture of `size` NEW_LAYER_WIDTH wide, or NEW_LAYER_MAX_HEIGHT tall if it's tall. */
function startingScale(size: Size): number {
  const tallest = (NEW_LAYER_MAX_HEIGHT * OUTPUT.height * size.width) / (OUTPUT.width * size.height);
  return Math.min(NEW_LAYER_WIDTH, tallest);
}

/**
 * Adds an image from `time` on, for NEW_LAYER_SECONDS or to the clip's end,
 * over the other layers but under the captions. The file becomes one of the
 * project's assets, unless it already is. Returns the new layer's id.
 */
export function addImageLayer(clipId: string, file: AssetFile, size: Size, time: number): string | null {
  const project = store().project;
  const clip = project?.clips.find((c) => c.id === clipId);
  if (!project || !clip) return null;
  const { rate, first, end } = clipFrames(clip);
  const length = Math.min(end - first, Math.round(NEW_LAYER_SECONDS * fps(rate)));
  const from = Math.min(Math.max(frameAt(time, rate), first), end - length);
  const start = timeOfFrame(from, rate);
  const existing = project.assets.find((a) => a.kind === 'image' && a.fingerprint === file.fingerprint);
  const assetId = existing?.id ?? crypto.randomUUID();
  const layer: TimedLayer = {
    id: crypto.randomUUID(),
    kind: 'image',
    assetId,
    start,
    end: timeOfFrame(from + length, rate),
    transform: [{ t: start, value: { x: 0.5, y: 0.5, scale: startingScale(size), rotation: 0, opacity: 1 }, ease: 'cut' }],
    motion: DEFAULT_MOTION,
    key: null,
  };
  editClip(clipId, 'history.addImage', (c, d) => {
    if (existing) Object.assign(d.assets.find((a) => a.id === existing.id)!, { path: file.path, name: file.name });
    else d.assets.push({ id: assetId, kind: 'image', ...file, ...size });
    const captions = c.layers.findIndex((l) => l.kind === 'caption');
    c.layers.splice(captions >= 0 ? captions : c.layers.length, 0, layer);
  });
  return layer.id;
}

/** Puts a different picture in the layer, keeping where it is and how it moves. */
export function replaceImage(clipId: string, layerId: string, file: AssetFile, size: Size): void {
  const existing = store().project?.assets.find((a) => a.kind === 'image' && a.fingerprint === file.fingerprint);
  const assetId = existing?.id ?? crypto.randomUUID();
  editClip(clipId, 'history.replaceImage', (c, d) => {
    const layer = c.layers.find((l) => l.id === layerId);
    if (!layer || !isTimed(layer)) return;
    if (!existing) d.assets.push({ id: assetId, kind: 'image', ...file, ...size });
    layer.assetId = assetId;
    pruneAssets(d);
  });
}

/**
 * Moves the layer in time so it starts at `start` (snapped to a frame and
 * kept inside the clip), its keyframes going with it.
 */
export function moveLayer(clipId: string, layerId: string, start: number): void {
  editLayer(clipId, layerId, 'history.moveLayer', (layer, clip) => {
    const { rate, first, end } = clipFrames(clip);
    const from = frameAt(layer.start, rate);
    const length = Math.min(frameAt(layer.end, rate) - from, end - first);
    const to = Math.min(Math.max(frameAt(start, rate), first), end - length);
    const shift = timeOfFrame(to, rate) - timeOfFrame(from, rate);
    if (shift === 0 && length === frameAt(layer.end, rate) - from) return;
    layer.start = timeOfFrame(to, rate);
    layer.end = timeOfFrame(to + length, rate);
    for (const key of layer.transform) key.t = Math.max(0, key.t + shift);
    // Keyframes left before a trimmed start can be pushed together at 0; the last of them wins.
    layer.transform = layer.transform.filter((k, i, keys) => i === keys.length - 1 || keys[i + 1]!.t > k.t);
  });
}

/** `time` moved inside the layer, so placement edits and keyframes land where the layer shows. */
export function insideLayer(layer: Pick<TimedLayer, 'start' | 'end'>, time: number): number {
  const rate = sourceRate();
  return timeOfFrame(Math.min(Math.max(frameAt(time, rate), frameAt(layer.start, rate)), frameAt(layer.end, rate) - 1), rate);
}

/** Moves one end of the layer to `time`, snapped to a frame, inside the clip and at least a frame long. */
export function trimLayer(clipId: string, layerId: string, edge: 'start' | 'end', time: number): void {
  editLayer(clipId, layerId, 'history.trimLayer', (layer, clip) => {
    const { rate, first, end } = clipFrames(clip);
    const at = frameAt(time, rate);
    if (edge === 'start') layer.start = timeOfFrame(Math.min(Math.max(at, first), frameAt(layer.end, rate) - 1), rate);
    else layer.end = timeOfFrame(Math.max(Math.min(at, end), frameAt(layer.start, rate) + 1), rate);
  });
}

/** Moves a layer (or the captions) one step up (drawn later) or down; the source video stays at the bottom. */
export function reorderLayer(clipId: string, layerId: string, direction: 'up' | 'down'): void {
  editClip(clipId, 'history.reorderLayer', (clip) => {
    const i = clip.layers.findIndex((l) => l.id === layerId);
    const j = direction === 'up' ? i + 1 : i - 1;
    if (i < 1 || j < 1 || j >= clip.layers.length) return;
    [clip.layers[i], clip.layers[j]] = [clip.layers[j]!, clip.layers[i]!];
  });
}

export function deleteLayer(clipId: string, layerId: string): void {
  editClip(clipId, 'history.deleteLayer', (clip, d) => {
    const i = clip.layers.findIndex((l) => l.id === layerId);
    if (i < 1 || !isTimed(clip.layers[i]!)) return;
    clip.layers.splice(i, 1);
    pruneAssets(d);
  });
}

/** A copy of the layer right above it; returns the copy's id. */
export function duplicateLayer(clipId: string, layerId: string): string {
  const id = crypto.randomUUID();
  editClip(clipId, 'history.duplicateLayer', (clip) => {
    const i = clip.layers.findIndex((l) => l.id === layerId);
    const layer = clip.layers[i];
    if (!layer || !isTimed(layer)) return;
    // A plain copy of the draft: structuredClone can't copy Immer's proxy.
    clip.layers.splice(i + 1, 0, { ...structuredClone(current(layer)), id });
  });
  return id;
}

/** Changes some of the layer's placement at `time`; dragging and sliders call it inside a gesture. */
export function setTransform(clipId: string, layerId: string, time: number, patch: Partial<Transform>): void {
  editLayer(clipId, layerId, 'history.placeLayer', (layer) => {
    const t = insideLayer(layer, time);
    layer.transform = editAt(layer.transform, t, clampTransform({ ...valueAt(layer.transform, t), ...patch }), sourceRate());
  });
}

export function addLayerKey(clipId: string, layerId: string, time: number): void {
  editLayer(clipId, layerId, 'history.addKeyframe', (layer) => {
    const t = insideLayer(layer, time);
    layer.transform = setKey(layer.transform, t, valueAt(layer.transform, t), sourceRate());
  });
}

export function deleteLayerKey(clipId: string, layerId: string, index: number): void {
  editLayer(clipId, layerId, 'history.deleteKeyframe', (layer) => void (layer.transform = removeKey(layer.transform, index)));
}

export function setLayerKeySmooth(clipId: string, layerId: string, index: number, smooth: boolean): void {
  editLayer(clipId, layerId, 'history.smoothKeyframe', (layer) => {
    const key = layer.transform[index];
    if (key) key.ease = smooth ? 'smooth' : 'cut';
  });
}

/** Changes part of how the layer comes in, goes out or moves while it's up. */
export function setMotion(clipId: string, layerId: string, part: keyof Motion, patch: Partial<Motion[keyof Motion]>): void {
  editLayer(clipId, layerId, 'history.layerAnimation', (layer) => void Object.assign(layer.motion[part], patch));
}

/**
 * Adds a video from `time` on, as long as the file runs or to the clip's
 * end, over the other layers but under the captions. Like an image, the
 * file becomes one of the project's assets unless it already is. Returns
 * the new layer's id, or "too-many" when MAX_VIDEO_LAYERS videos would
 * show at once somewhere in its time.
 */
export function addVideoLayer(clipId: string, file: AssetFile, info: VideoInfo, time: number): string | 'too-many' | null {
  const project = store().project;
  const clip = project?.clips.find((c) => c.id === clipId);
  if (!project || !clip) return null;
  const { rate, first, end } = clipFrames(clip);
  const length = Math.max(1, Math.min(end - first, Math.round(info.duration * fps(rate))));
  const from = Math.min(Math.max(frameAt(time, rate), first), end - length);
  const start = timeOfFrame(from, rate);
  const existing = project.assets.find((a) => a.kind === 'video' && a.fingerprint === file.fingerprint);
  const assetId = existing?.id ?? crypto.randomUUID();
  const layer: OverlayLayer = {
    id: crypto.randomUUID(),
    kind: 'overlay',
    assetId,
    start,
    end: timeOfFrame(from + length, rate),
    transform: [{ t: start, value: { x: 0.5, y: 0.5, scale: startingScale(info), rotation: 0, opacity: 1 }, ease: 'cut' }],
    motion: DEFAULT_MOTION,
    key: null,
    offset: 0,
    volume: 1,
    loop: false,
  };
  if (videoLayersOverLimit({ layers: [...clip.layers, layer] }).has(layer.id)) return 'too-many';
  editClip(clipId, 'history.addVideo', (c, d) => {
    if (existing) Object.assign(d.assets.find((a) => a.id === existing.id)!, { path: file.path, name: file.name });
    else d.assets.push({ id: assetId, kind: 'video', ...file, ...info });
    const captions = c.layers.findIndex((l) => l.kind === 'caption');
    c.layers.splice(captions >= 0 ? captions : c.layers.length, 0, layer);
  });
  return layer.id;
}

/** Puts a different video in the layer, keeping where it is, how it moves and its sound settings. */
export function replaceVideo(clipId: string, layerId: string, file: AssetFile, info: VideoInfo): void {
  const existing = store().project?.assets.find((a) => a.kind === 'video' && a.fingerprint === file.fingerprint);
  const assetId = existing?.id ?? crypto.randomUUID();
  editClip(clipId, 'history.replaceVideo', (c, d) => {
    const layer = c.layers.find((l) => l.id === layerId);
    if (layer?.kind !== 'overlay') return;
    if (!existing) d.assets.push({ id: assetId, kind: 'video', ...file, ...info });
    layer.assetId = assetId;
    // The new file may be shorter.
    layer.offset = Math.min(layer.offset, Math.max(0, info.duration - 1 / fps(sourceRate())));
    pruneAssets(d);
  });
}

/** A video layer's volume (0..1) or whether it loops; the volume slider calls it inside a gesture. */
export function setLayerSound(clipId: string, layerId: string, patch: Partial<Pick<OverlayLayer, 'volume' | 'loop'>>): void {
  editLayer(clipId, layerId, 'history.layerSound', (layer) => {
    if (layer.kind !== 'overlay') return;
    if (patch.volume !== undefined) layer.volume = Math.min(1, Math.max(0, patch.volume));
    if (patch.loop !== undefined) layer.loop = patch.loop;
  });
}

/** Where in its file a video layer starts playing, snapped to a frame of the clip and inside the file. */
export function setVideoStart(clipId: string, layerId: string, offset: number, duration: number): void {
  editLayer(clipId, layerId, 'history.videoStart', (layer) => {
    if (layer.kind !== 'overlay') return;
    const rate = sourceRate();
    const last = Math.max(0, Math.ceil(duration * fps(rate)) - 1);
    layer.offset = timeOfFrame(Math.min(Math.max(Math.round(offset * fps(rate)), 0), last), rate);
  });
}

/**
 * Turns the layer's green screen on (with the usual settings, or `patch`
 * over the ones it has), changes it, or turns it off with null.
 */
export function setChromaKey(clipId: string, layerId: string, patch: Partial<ChromaKey> | null): void {
  editLayer(clipId, layerId, 'history.greenScreen', (layer) => {
    layer.key = patch === null ? null : { ...(layer.key ?? DEFAULT_CHROMA_KEY), ...patch };
  });
}
