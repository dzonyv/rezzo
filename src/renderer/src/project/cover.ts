/**
 * Edits to a clip's cover (shared/cover.ts). The cover is made the first
 * time one of these changes it. Its layers are edited with the functions
 * in project/layers.ts, which find a layer on the cover as on the clip,
 * and its framing with those in project/framing.ts, with target "cover".
 */
import type { Draft } from 'immer';
import type { AssetFile } from '../../../shared/assets.ts';
import { coverOf, keptTime, NO_MOTION } from '../../../shared/cover.ts';
import { DEFAULT_CUTOUT_STYLE, type CutoutStyle } from '../../../shared/cutout.ts';
import type { EffectName } from '../../../shared/effects.ts';
import type { Size } from '../../../shared/framing.ts';
import { frameAt, timeOfFrame, type FrameRate } from '../../../shared/frames.ts';
import type { Clip, Cover, PlacedCoverLayer, Project } from '../../../shared/project.ts';
import { DEFAULT_TEXT_STYLE, MAX_TEXT_CHARS, type TextStyle } from '../../../shared/text-style.ts';
import { sourceRate } from './framing.ts';
import { adoptFile, newEffectLayer, startingScale } from './layers.ts';
import { projectStore, type EditLabel } from './store.ts';

/** A new title on the cover sits this far down, a bit above the middle: big, and clear of the platforms' buttons at the bottom. */
const NEW_TEXT_Y = 0.4;

function editCover(clipId: string, label: EditLabel, recipe: (cover: Draft<Cover>, clip: Draft<Clip>, project: Draft<Project>) => void): void {
  projectStore.getState().edit(label, (d) => {
    const clip = d.clips.find((c) => c.id === clipId);
    if (!clip) return;
    const cover = (clip.cover ??= coverOf(clip));
    recipe(cover, clip, d);
  });
}

/** The clip's first and last frame. */
function frameRange(clip: Pick<Clip, 'start' | 'end'>, rate: FrameRate) {
  return { first: frameAt(clip.start, rate), last: Math.max(frameAt(clip.start, rate), frameAt(clip.end, rate) - 1) };
}

/** Moves the cover to the frame at `time`, kept inside what the clip plays; the moment slider calls it inside a gesture. */
export function setCoverTime(clipId: string, time: number): void {
  editCover(clipId, 'history.coverMoment', (cover, clip) => {
    const rate = sourceRate();
    const { first, last } = frameRange(clip, rate);
    cover.time = keptTime(clip, timeOfFrame(Math.min(Math.max(frameAt(time, rate), first), last), rate));
  });
}

/**
 * Moves the cover `by` frames on (back when negative) to the next frame
 * the clip plays, over any stretch it leaves out; at the clip's first or
 * last frame it stays.
 */
export function stepCoverTime(clipId: string, by: number): void {
  const clip = projectStore.getState().project?.clips.find((c) => c.id === clipId);
  if (!clip || by === 0) return;
  const rate = sourceRate();
  const { first, last } = frameRange(clip, rate);
  const from = frameAt(coverOf(clip).time, rate);
  const step = Math.sign(by);
  for (let f = Math.min(Math.max(from + by, first), last); step > 0 ? f <= last : f >= first; f += step) {
    const at = timeOfFrame(f, rate);
    if (f !== from && Math.abs(keptTime(clip, at) - at) < 1e-6) return setCoverTime(clipId, at);
  }
}

/** Whether the cover is also put on the exported video's first frames. */
export function setCoverInVideo(clipId: string, on: boolean): void {
  editCover(clipId, 'history.coverInVideo', (cover) => void (cover.inVideo = on));
}

/** The cover goes back to the clip's framing at its moment. */
export function followClipFraming(clipId: string): void {
  editCover(clipId, 'history.coverFraming', (cover) => void (cover.video = null));
}

/** One key, at the cover's moment. */
const placed = (cover: Draft<Cover>, value: PlacedCoverLayer['transform'][number]['value']) => [{ t: cover.time, value, ease: 'cut' as const }];

/** Adds text over the cover's other layers, in the default style unless `style` is given; returns its id. */
export function addCoverText(clipId: string, text: string, style: TextStyle = DEFAULT_TEXT_STYLE): string {
  const id = crypto.randomUUID();
  editCover(clipId, 'history.addText', (cover, clip) => {
    cover.layers.push({
      id,
      kind: 'text',
      text: text.slice(0, MAX_TEXT_CHARS),
      style,
      start: clip.start,
      end: clip.end,
      transform: placed(cover, { x: 0.5, y: NEW_TEXT_Y, scale: 1, rotation: 0, opacity: 1 }),
      motion: NO_MOTION,
    });
  });
  return id;
}

/** Adds an image over the cover's other layers, in the middle; the file becomes one of the project's assets unless it already is. Returns its id. */
export function addCoverImage(clipId: string, file: AssetFile, size: Size): string {
  const id = crypto.randomUUID();
  const existing = adoptFile('image', file);
  const assetId = existing?.id ?? crypto.randomUUID();
  editCover(clipId, 'history.addImage', (cover, clip, d) => {
    if (!existing) d.assets.push({ id: assetId, kind: 'image', ...file, ...size });
    cover.layers.push({
      id,
      kind: 'image',
      assetId,
      start: clip.start,
      end: clip.end,
      transform: placed(cover, { x: 0.5, y: 0.5, scale: startingScale(size), rotation: 0, opacity: 1 }),
      motion: NO_MOTION,
      key: null,
    });
  });
  return id;
}

/**
 * Adds the people cut out over the cover's other layers, so they all go
 * behind them; returns its id.
 */
export function addCoverCutout(clipId: string): string {
  const id = crypto.randomUUID();
  editCover(clipId, 'history.addCutout', (cover, clip) => {
    cover.layers.push({ id, kind: 'cutout', start: clip.start, end: clip.end, style: structuredClone(DEFAULT_CUTOUT_STYLE) });
  });
  return id;
}

/**
 * Adds an effect to the cover, over the effects already at the bottom of
 * it but under everything else, so it changes the picture and not the
 * cutout or the title; returns its id.
 */
export function addCoverEffect(clipId: string, effect: EffectName): string {
  let id = '';
  editCover(clipId, 'history.addEffect', (cover, clip) => {
    const layer = newEffectLayer(effect, clip.start, clip.end, cover.time);
    id = layer.id;
    const above = cover.layers.findIndex((l) => l.kind !== 'effect');
    cover.layers.splice(above < 0 ? cover.layers.length : above, 0, layer);
  });
  return id;
}

/** Changes the cutout's outline or glow; sliders and colour pickers call it inside a gesture. */
export function setCutoutStyle<P extends keyof CutoutStyle>(clipId: string, layerId: string, part: P, patch: Partial<CutoutStyle[P]>): void {
  editCover(clipId, 'history.cutoutStyle', (cover) => {
    const layer = cover.layers.find((l) => l.id === layerId);
    if (layer?.kind === 'cutout') Object.assign(layer.style[part], patch);
  });
}
