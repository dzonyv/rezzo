/**
 * Edits to a clip's cover (shared/cover.ts). The cover is made the first
 * time one of these changes it. Its layers are edited with the functions
 * in project/layers.ts, which find a layer on the cover as on the clip,
 * and its framing with those in project/framing.ts, with target "cover".
 */
import type { Draft } from 'immer';
import type { AssetFile } from '../../../shared/assets.ts';
import { coverOf, keptTime, NO_MOTION } from '../../../shared/cover.ts';
import type { Size } from '../../../shared/framing.ts';
import { frameAt, timeOfFrame } from '../../../shared/frames.ts';
import type { Clip, Cover, CoverLayer, Project } from '../../../shared/project.ts';
import { DEFAULT_TEXT_STYLE, MAX_TEXT_CHARS, type TextStyle } from '../../../shared/text-style.ts';
import { sourceRate } from './framing.ts';
import { adoptFile, startingScale } from './layers.ts';
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

/** Moves the cover to the frame at `time`, kept inside what the clip plays; the moment slider calls it inside a gesture. */
export function setCoverTime(clipId: string, time: number): void {
  editCover(clipId, 'history.coverMoment', (cover, clip) => {
    const rate = sourceRate();
    cover.time = keptTime(clip, timeOfFrame(frameAt(time, rate), rate));
  });
}

/** The cover goes back to the clip's framing at its moment. */
export function followClipFraming(clipId: string): void {
  editCover(clipId, 'history.coverFraming', (cover) => void (cover.video = null));
}

/** One key, at the cover's moment. */
const placed = (cover: Draft<Cover>, value: CoverLayer['transform'][number]['value']) => [{ t: cover.time, value, ease: 'cut' as const }];

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
