/**
 * Edits to the layers over a clip's picture: adding images, videos,
 * animations and effects, moving and trimming them in time, stacking them,
 * placing them and animating them. Placement and an effect's intensity
 * work like framing (see project/framing.ts): while they have one keyframe
 * an edit changes them for the layer's whole time.
 */
import { current, type Draft } from 'immer';
import type { Asset, AssetFile, AudioInfo, VideoInfo } from '../../../shared/assets.ts';
import { DEFAULT_CHROMA_KEY, type ChromaKey } from '../../../shared/chroma-key.ts';
import { defaultParams, EFFECTS, type EffectName, type ParamDef } from '../../../shared/effects.ts';
import { editAt, OUTPUT, removeKey, setKey, valueAt, type Size } from '../../../shared/framing.ts';
import { fps, frameAt, timeOfFrame, workingFrameRate } from '../../../shared/frames.ts';
import { lottieSeconds, type LottieInfo } from '../../../shared/lottie.ts';
import { clampTransform, DEFAULT_MOTION, type Motion, type Transform } from '../../../shared/motion.ts';
import { videoLayersOverLimit } from '../../../shared/overlay-files.ts';
import { DEFAULT_DUCK_DB, DUCK_BY_DEFAULT_SECONDS, MAX_DUCK_DB, MIN_DUCK_DB, type Duck } from '../../../shared/ducking.ts';
import { followerOf, syncFollowers } from '../../../shared/follow-sounds.ts';
import { FOLLOW_PARTS, MAX_FADE_SECONDS, MAX_FOLLOW_SHIFT, SOUNDS, type FollowPart, type SoundName, type SoundSource } from '../../../shared/sounds.ts';
import {
  isPlaced, isSound, isTimed, keyframesOf, layerAssetIds, MAX_LOTTIE_SPEED, MIN_LOTTIE_SPEED, type Animated, type Clip, type EffectLayer, type Layer, type LottieLayer,
  type OverlayLayer, type PlacedLayer, type Project, type SoundLayer, type TimedLayer,
} from '../../../shared/project.ts';
import { sourceRate } from './framing.ts';
import { projectStore, type EditLabel } from './store.ts';

/** A new image shows this long, or to the end of the clip. */
export const NEW_LAYER_SECONDS = 3;
/** A new image is this wide (a share of the output), unless that makes it too tall. */
const NEW_LAYER_WIDTH = 0.6;
const NEW_LAYER_MAX_HEIGHT = 0.5;

const store = () => projectStore.getState();

/** Runs an edit on the clip; the sounds that go with its layers follow them afterwards (shared/follow-sounds.ts). */
function editClip(clipId: string, label: EditLabel, recipe: (clip: Draft<Clip>, project: Draft<Project>) => void): void {
  store().edit(label, (d) => {
    const clip = d.clips.find((c) => c.id === clipId);
    if (!clip) return;
    recipe(clip, d);
    // A sound deleted with its layer may have been the last to use its file.
    if (d.source && syncFollowers(clip, d.assets, workingFrameRate(d.source))) pruneAssets(d);
  });
}

function editLayer(clipId: string, layerId: string, label: EditLabel, recipe: (layer: Draft<TimedLayer>, clip: Draft<Clip>) => void): void {
  editClip(clipId, label, (clip) => {
    const layer = clip.layers.find((l) => l.id === layerId);
    if (layer && isTimed(layer)) recipe(layer, clip);
  });
}

function editPlaced(clipId: string, layerId: string, label: EditLabel, recipe: (layer: Draft<PlacedLayer>, clip: Draft<Clip>) => void): void {
  editLayer(clipId, layerId, label, (layer, clip) => {
    if (isPlaced(layer)) recipe(layer, clip);
  });
}

/** Drops assets no layer uses any more, in the same edit that stopped using them. */
function pruneAssets(d: Draft<Project>): void {
  const used = new Set(d.clips.flatMap(layerAssetIds));
  d.assets = d.assets.filter((a) => used.has(a.id));
}

/**
 * The project's asset for a picked file, when it already has that file
 * (told by its content); undefined for a file new to it. The asset learns
 * where the file is now, so picking a moved file again finds it. Like
 * finding a moved file that's not an edit (see locateAsset): undo would
 * point the project back where the file isn't.
 */
function adoptFile(kind: Asset['kind'], file: AssetFile): Asset | undefined {
  const existing = store().project?.assets.find((a) => a.kind === kind && a.fingerprint === file.fingerprint);
  if (existing && (existing.path !== file.path || existing.name !== file.name || existing.size !== file.size)) {
    store().replace((d) => void Object.assign(d.assets.find((a) => a.id === existing.id)!, { path: file.path, name: file.name, size: file.size }));
  }
  return existing;
}

/** Puts a new layer over the others but under the captions. */
function insertLayer(clip: Draft<Clip>, layer: Layer): void {
  const captions = clip.layers.findIndex((l) => l.kind === 'caption');
  clip.layers.splice(captions >= 0 ? captions : clip.layers.length, 0, layer);
}

/** Frame times inside the clip: [first, last frame start]. */
function clipFrames(clip: Pick<Clip, 'start' | 'end'>) {
  const rate = sourceRate();
  return { rate, first: frameAt(clip.start, rate), end: frameAt(clip.end, rate) };
}

/** Where a new layer goes in time: `seconds` long from `time` on, at least a frame, kept inside the clip. */
function newLayerTime(clip: Pick<Clip, 'start' | 'end'>, time: number, seconds: number): { start: number; end: number } {
  const { rate, first, end } = clipFrames(clip);
  const length = Math.max(1, Math.min(end - first, Math.round(seconds * fps(rate))));
  const from = Math.min(Math.max(frameAt(time, rate), first), end - length);
  return { start: timeOfFrame(from, rate), end: timeOfFrame(from + length, rate) };
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
  const existing = adoptFile('image', file);
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
    if (!existing) d.assets.push({ id: assetId, kind: 'image', ...file, ...size });
    insertLayer(c, layer);
  });
  return layer.id;
}

/** Puts a different picture in the layer, keeping where it is and how it moves. */
export function replaceImage(clipId: string, layerId: string, file: AssetFile, size: Size): void {
  const existing = adoptFile('image', file);
  const assetId = existing?.id ?? crypto.randomUUID();
  editClip(clipId, 'history.replaceImage', (c, d) => {
    const layer = c.layers.find((l) => l.id === layerId);
    if (layer?.kind !== 'image') return;
    if (!existing) d.assets.push({ id: assetId, kind: 'image', ...file, ...size });
    layer.assetId = assetId;
    pruneAssets(d);
  });
}

/** Replaces the keyframes keyframesOf(layer) names. */
function setKeysOf(layer: Draft<TimedLayer>, keys: Animated<unknown>): void {
  if (layer.kind === 'effect') layer.intensity = keys as Animated<number>;
  else if (layer.kind !== 'sound') layer.transform = keys as typeof layer.transform;
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
    for (const key of keyframesOf(layer)) key.t = Math.max(0, key.t + shift);
    // Keyframes left before a trimmed start can be pushed together at 0; the last of them wins.
    setKeysOf(layer, keyframesOf(layer).filter((k, i, keys) => i === keys.length - 1 || keys[i + 1]!.t > k.t));
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

/**
 * Moves a layer (or the captions) one step up (drawn later) or down, past
 * the next layer that draws something; the source video stays at the
 * bottom, and sounds have no place in the order.
 */
export function reorderLayer(clipId: string, layerId: string, direction: 'up' | 'down'): void {
  editClip(clipId, 'history.reorderLayer', (clip) => {
    const i = clip.layers.findIndex((l) => l.id === layerId);
    if (i < 1 || isSound(clip.layers[i]!)) return;
    const step = direction === 'up' ? 1 : -1;
    let j = i + step;
    while (j >= 1 && j < clip.layers.length && isSound(clip.layers[j]!)) j += step;
    if (j < 1 || j >= clip.layers.length) return;
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

/**
 * A copy of the layer right above it; returns the copy's id. The sounds
 * that go with a layer are copied along with it, for the copy. A copy of
 * such a sound stands on its own: the part it went with already has one.
 */
export function duplicateLayer(clipId: string, layerId: string): string {
  const id = crypto.randomUUID();
  editClip(clipId, 'history.duplicateLayer', (clip) => {
    const i = clip.layers.findIndex((l) => l.id === layerId);
    const layer = clip.layers[i];
    if (!layer || !isTimed(layer)) return;
    // A plain copy of the draft: structuredClone can't copy Immer's proxy.
    const copy: Layer = { ...structuredClone(current(layer)), id };
    if (copy.kind === 'sound') copy.follows = null;
    clip.layers.splice(i + 1, 0, copy);
    for (const part of FOLLOW_PARTS) {
      const sound = followerOf(clip, layerId, part);
      if (sound?.follows) clip.layers.push({ ...structuredClone(current(sound)), id: crypto.randomUUID(), follows: { ...sound.follows, layerId: id } });
    }
  });
  return id;
}

/** Changes some of the layer's placement at `time`; dragging and sliders call it inside a gesture. */
export function setTransform(clipId: string, layerId: string, time: number, patch: Partial<Transform>): void {
  editPlaced(clipId, layerId, 'history.placeLayer', (layer) => {
    const t = insideLayer(layer, time);
    layer.transform = editAt(layer.transform, t, clampTransform({ ...valueAt(layer.transform, t), ...patch }), sourceRate());
  });
}

/** A keyframe of the layer's placement (or an effect's intensity) at `time`, with the value it has there. */
export function addLayerKey(clipId: string, layerId: string, time: number): void {
  editLayer(clipId, layerId, 'history.addKeyframe', (layer) => {
    const t = insideLayer(layer, time);
    const keys = keyframesOf(layer);
    setKeysOf(layer, setKey(keys, t, valueAt(keys, t), sourceRate()));
  });
}

export function deleteLayerKey(clipId: string, layerId: string, index: number): void {
  editLayer(clipId, layerId, 'history.deleteKeyframe', (layer) => setKeysOf(layer, removeKey(keyframesOf(layer), index)));
}

export function setLayerKeySmooth(clipId: string, layerId: string, index: number, smooth: boolean): void {
  editLayer(clipId, layerId, 'history.smoothKeyframe', (layer) => {
    const key = keyframesOf(layer)[index];
    if (key) key.ease = smooth ? 'smooth' : 'cut';
  });
}

/** Changes part of how the layer comes in, goes out or moves while it's up. */
export function setMotion(clipId: string, layerId: string, part: keyof Motion, patch: Partial<Motion[keyof Motion]>): void {
  editPlaced(clipId, layerId, 'history.layerAnimation', (layer) => void Object.assign(layer.motion[part], patch));
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
  const existing = adoptFile('video', file);
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
    if (!existing) d.assets.push({ id: assetId, kind: 'video', ...file, ...info });
    insertLayer(c, layer);
  });
  return layer.id;
}

/** Puts a different video in the layer, keeping where it is, how it moves and its sound settings. */
export function replaceVideo(clipId: string, layerId: string, file: AssetFile, info: VideoInfo): void {
  const existing = adoptFile('video', file);
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
    if (layer.kind !== 'image' && layer.kind !== 'overlay') return;
    layer.key = patch === null ? null : { ...(layer.key ?? DEFAULT_CHROMA_KEY), ...patch };
  });
}

/**
 * Adds a Lottie animation from `time` on, as long as it runs or to the
 * clip's end, over the other layers but under the captions. Like an image,
 * the file becomes one of the project's assets unless it already is.
 * Returns the new layer's id.
 */
export function addLottieLayer(clipId: string, file: AssetFile, info: LottieInfo, time: number): string | null {
  const project = store().project;
  const clip = project?.clips.find((c) => c.id === clipId);
  if (!project || !clip) return null;
  const { start, end } = newLayerTime(clip, time, lottieSeconds(info));
  const existing = adoptFile('lottie', file);
  const assetId = existing?.id ?? crypto.randomUUID();
  const layer: LottieLayer = {
    id: crypto.randomUUID(),
    kind: 'lottie',
    assetId,
    start,
    end,
    transform: [{ t: start, value: { x: 0.5, y: 0.5, scale: startingScale(info), rotation: 0, opacity: 1 }, ease: 'cut' }],
    // An animation usually comes in on its own.
    motion: { ...DEFAULT_MOTION, in: { ...DEFAULT_MOTION.in, kind: 'none' } },
    speed: 1,
    loop: false,
  };
  editClip(clipId, 'history.addLottie', (c, d) => {
    if (!existing) d.assets.push({ id: assetId, kind: 'lottie', ...file, ...info });
    insertLayer(c, layer);
  });
  return layer.id;
}

/** Puts a different animation in the layer, keeping where it is, how it moves and how it plays. */
export function replaceLottie(clipId: string, layerId: string, file: AssetFile, info: LottieInfo): void {
  const existing = adoptFile('lottie', file);
  const assetId = existing?.id ?? crypto.randomUUID();
  editClip(clipId, 'history.replaceLottie', (c, d) => {
    const layer = c.layers.find((l) => l.id === layerId);
    if (layer?.kind !== 'lottie') return;
    if (!existing) d.assets.push({ id: assetId, kind: 'lottie', ...file, ...info });
    layer.assetId = assetId;
    pruneAssets(d);
  });
}

/** How fast a Lottie layer plays and whether it starts over; the speed slider calls it inside a gesture. */
export function setLottiePlayback(clipId: string, layerId: string, patch: Partial<Pick<LottieLayer, 'speed' | 'loop'>>): void {
  editLayer(clipId, layerId, 'history.lottiePlayback', (layer) => {
    if (layer.kind !== 'lottie') return;
    if (patch.speed !== undefined) layer.speed = Math.min(MAX_LOTTIE_SPEED, Math.max(MIN_LOTTIE_SPEED, patch.speed));
    if (patch.loop !== undefined) layer.loop = patch.loop;
  });
}

/**
 * Adds an effect from `time` on, as long as effects of its kind usually
 * last or to the clip's end, over the other layers but under the captions,
 * so the captions stay clean. Returns the new layer's id.
 */
export function addEffectLayer(clipId: string, effect: EffectName, time: number): string | null {
  const clip = store().project?.clips.find((c) => c.id === clipId);
  if (!clip) return null;
  const { start, end } = newLayerTime(clip, time, EFFECTS[effect].seconds);
  const layer: EffectLayer = { id: crypto.randomUUID(), kind: 'effect', effect, start, end, intensity: [{ t: start, value: 1, ease: 'cut' }], params: defaultParams(effect) };
  editClip(clipId, 'history.addEffect', (c) => insertLayer(c, layer));
  return layer.id;
}

/** Changes an effect's intensity (0..1) at `time`; the slider calls it inside a gesture. */
export function setIntensity(clipId: string, layerId: string, time: number, value: number): void {
  editLayer(clipId, layerId, 'history.effectIntensity', (layer) => {
    if (layer.kind !== 'effect') return;
    layer.intensity = editAt(layer.intensity, insideLayer(layer, time), Math.min(1, Math.max(0, value)), sourceRate());
  });
}

/** Changes one of an effect's own settings, kept in its range; the sliders call it inside a gesture. */
export function setEffectParam(clipId: string, layerId: string, param: string, value: number): void {
  editLayer(clipId, layerId, 'history.effectSettings', (layer) => {
    if (layer.kind !== 'effect') return;
    const def: ParamDef | undefined = (EFFECTS[layer.effect].params as Record<string, ParamDef>)[param];
    if (def) layer.params[param] = Math.min(def.max, Math.max(def.min, value));
  });
}

/**
 * A new sound layer: `seconds` long from `time` on, at full volume, with
 * no fades. A file of the user's own is evened out, and turned down while
 * someone talks when it's long enough to be music.
 */
function newSoundLayer(clip: Pick<Clip, 'start' | 'end'>, sound: SoundLayer['sound'], time: number, seconds: number): SoundLayer {
  const { start, end } = newLayerTime(clip, time, seconds);
  const own = 'assetId' in sound;
  return {
    id: crypto.randomUUID(), kind: 'sound', sound, start, end, offset: 0, volume: 1, fadeIn: 0, fadeOut: 0, loop: false, evenLoudness: own, follows: null,
    duck: { on: own && seconds >= DUCK_BY_DEFAULT_SECONDS, db: DEFAULT_DUCK_DB },
  };
}

/**
 * Makes `sound` go with part of a placed layer's animation: it takes the
 * place of the sound that went with it (keeping that one's volume and
 * fades), or comes new at full volume. `asset` is a file new to the
 * project that it plays.
 */
function follow(clipId: string, layerId: string, part: FollowPart, sound: SoundSource, asset?: Asset): string | null {
  const clip = store().project?.clips.find((c) => c.id === clipId);
  const layer = clip?.layers.find((l) => l.id === layerId);
  if (!clip || !layer || !isPlaced(layer)) return null;
  const existing = followerOf(clip, layerId, part);
  const id = existing?.id ?? crypto.randomUUID();
  editClip(clipId, 'history.followSound', (c, d) => {
    if (asset) d.assets.push(asset);
    const old = followerOf(c, layerId, part);
    if (old) Object.assign(old, { sound, offset: 0, evenLoudness: 'assetId' in sound });
    // Its time comes from the layer once the edit is done; a frame for now.
    else c.layers.push({ ...newSoundLayer(c, sound, layer.start, 0), id, follows: { layerId, part, shift: 0 } });
    pruneAssets(d);
  });
  return id;
}

/** A sound from the library with part of the layer's animation, or none with null. Returns the sound layer's id. */
export function setFollowSound(clipId: string, layerId: string, part: FollowPart, name: SoundName | null): string | null {
  if (name !== null) return follow(clipId, layerId, part, { library: name });
  const clip = store().project?.clips.find((c) => c.id === clipId);
  const sound = clip && followerOf(clip, layerId, part);
  if (sound) deleteLayer(clipId, sound.id);
  return null;
}

/** One of the project's sound files with part of the layer's animation. */
export const setFollowSoundAsset = (clipId: string, layerId: string, part: FollowPart, assetId: string): string | null =>
  follow(clipId, layerId, part, { assetId });

/** A sound file of the user's own with part of the layer's animation; like adding one, it becomes one of the project's assets. */
export function setFollowSoundFile(clipId: string, layerId: string, part: FollowPart, file: AssetFile, info: AudioInfo): string | null {
  const existing = adoptFile('audio', file);
  const assetId = existing?.id ?? crypto.randomUUID();
  return follow(clipId, layerId, part, { assetId }, existing ? undefined : { id: assetId, kind: 'audio', ...file, ...info });
}

/** Moves a sound that goes with a layer earlier or later than its anchor; the slider calls it inside a gesture. */
export function setFollowShift(clipId: string, soundId: string, shift: number): void {
  editLayer(clipId, soundId, 'history.followSound', (layer) => {
    if (layer.kind !== 'sound' || !layer.follows) return;
    layer.follows.shift = Math.round(Math.min(MAX_FOLLOW_SHIFT, Math.max(-MAX_FOLLOW_SHIFT, shift)) * 100) / 100;
  });
}

/** Lets a sound stand on its own where it is, no longer going with its layer. */
export function unlinkSound(clipId: string, soundId: string): void {
  editLayer(clipId, soundId, 'history.unlinkSound', (layer) => {
    if (layer.kind === 'sound') layer.follows = null;
  });
}

/** Adds a sound from the library at `time`, as long as it is. Returns the new layer's id. */
export function addLibrarySound(clipId: string, name: SoundName, time: number): string | null {
  const clip = store().project?.clips.find((c) => c.id === clipId);
  if (!clip) return null;
  const layer = newSoundLayer(clip, { library: name }, time, SOUNDS[name].seconds);
  editClip(clipId, 'history.addSound', (c) => void c.layers.push(layer));
  return layer.id;
}

/**
 * Adds a sound file from `time` on, as long as it runs or to the clip's
 * end. Like an image, the file becomes one of the project's assets unless
 * it already is. Returns the new layer's id.
 */
export function addSoundFile(clipId: string, file: AssetFile, info: AudioInfo, time: number): string | null {
  const project = store().project;
  const clip = project?.clips.find((c) => c.id === clipId);
  if (!project || !clip) return null;
  const existing = adoptFile('audio', file);
  const assetId = existing?.id ?? crypto.randomUUID();
  const layer = newSoundLayer(clip, { assetId }, time, info.duration);
  editClip(clipId, 'history.addSound', (c, d) => {
    if (!existing) d.assets.push({ id: assetId, kind: 'audio', ...file, ...info });
    c.layers.push(layer);
  });
  return layer.id;
}

/** Puts a different sound file in the layer, keeping where it plays and how. */
export function replaceSoundFile(clipId: string, layerId: string, file: AssetFile, info: AudioInfo): void {
  const existing = adoptFile('audio', file);
  const assetId = existing?.id ?? crypto.randomUUID();
  editClip(clipId, 'history.replaceSound', (c, d) => {
    const layer = c.layers.find((l) => l.id === layerId);
    if (layer?.kind !== 'sound') return;
    if (!existing) d.assets.push({ id: assetId, kind: 'audio', ...file, ...info });
    layer.sound = { assetId };
    layer.offset = Math.min(layer.offset, Math.max(0, info.duration - 0.1));
    pruneAssets(d);
  });
}

/** A sound layer's volume (0..1), fades (seconds), whether it loops or is evened out; the sliders call it inside a gesture. */
export function setSoundSettings(clipId: string, layerId: string, patch: Partial<Pick<SoundLayer, 'volume' | 'fadeIn' | 'fadeOut' | 'loop' | 'evenLoudness'>>): void {
  editLayer(clipId, layerId, 'history.soundSettings', (layer) => {
    if (layer.kind !== 'sound') return;
    const fade = (v: number) => Math.min(MAX_FADE_SECONDS, Math.max(0, v));
    if (patch.volume !== undefined) layer.volume = Math.min(1, Math.max(0, patch.volume));
    if (patch.fadeIn !== undefined) layer.fadeIn = fade(patch.fadeIn);
    if (patch.fadeOut !== undefined) layer.fadeOut = fade(patch.fadeOut);
    if (patch.loop !== undefined) layer.loop = patch.loop;
    if (patch.evenLoudness !== undefined) layer.evenLoudness = patch.evenLoudness;
  });
}

/** Whether a sound layer is turned down while someone talks, and by how many dB; the slider calls it inside a gesture. */
export function setSoundDuck(clipId: string, layerId: string, patch: Partial<Duck>): void {
  editLayer(clipId, layerId, 'history.duck', (layer) => {
    if (layer.kind !== 'sound') return;
    if (patch.on !== undefined) layer.duck.on = patch.on;
    if (patch.db !== undefined) layer.duck.db = Math.round(Math.min(MAX_DUCK_DB, Math.max(MIN_DUCK_DB, patch.db)));
  });
}

/** Whether the clip's own sound has its loudness evened out. */
export function setClipEvenLoudness(clipId: string, on: boolean): void {
  editClip(clipId, 'history.evenLoudness', (clip) => {
    clip.evenLoudness = on;
  });
}

/** Where in its file a sound layer starts playing, inside the file; the slider calls it inside a gesture. */
export function setSoundStart(clipId: string, layerId: string, offset: number, duration: number): void {
  editLayer(clipId, layerId, 'history.soundStart', (layer) => {
    if (layer.kind !== 'sound') return;
    layer.offset = Math.round(Math.min(Math.max(offset, 0), Math.max(0, duration - 0.1)) * 1000) / 1000;
  });
}
