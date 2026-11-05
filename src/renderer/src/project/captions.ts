/**
 * Edits to a clip's captions: adding and removing them, their style and
 * their position. Position edits work like framing (see project/framing.ts):
 * with one keyframe they move the captions for the whole clip.
 */
import type { Draft } from 'immer';
import { DEFAULT_CAPTION_STYLE, type CaptionStyle } from '../../../shared/caption-style.ts';
import { captionYAt, newCaptionLayer } from '../../../shared/captions.ts';
import { editAt, removeKey, setKey } from '../../../shared/framing.ts';
import { videoLayerOf, type CaptionLayer, type Clip } from '../../../shared/project.ts';
import { currentSettings } from '../settings.ts';
import { sourceRate } from './framing.ts';
import { projectStore, type EditLabel } from './store.ts';

/** The style new captions get: the user's default, or the built-in one. */
export const defaultStyle = (): CaptionStyle => currentSettings()?.defaultCaptionStyle ?? DEFAULT_CAPTION_STYLE;

function editCaptions(clipId: string, label: EditLabel, recipe: (layer: Draft<CaptionLayer>, clip: Draft<Clip>) => void): void {
  projectStore.getState().edit(label, (d) => {
    const clip = d.clips.find((c) => c.id === clipId);
    const layer = clip?.layers.find((l) => l.kind === 'caption');
    if (clip && layer) recipe(layer, clip);
  });
}

export function addCaptions(clipId: string): void {
  projectStore.getState().edit('history.addCaptions', (d) => {
    const clip = d.clips.find((c) => c.id === clipId);
    if (clip && !clip.layers.some((l) => l.kind === 'caption')) clip.layers.push(newCaptionLayer(clip.start, defaultStyle()));
  });
}

export function removeCaptions(clipId: string): void {
  projectStore.getState().edit('history.removeCaptions', (d) => {
    const clip = d.clips.find((c) => c.id === clipId);
    if (clip) clip.layers = clip.layers.filter((l) => l.kind !== 'caption');
  });
}

/** Changes some of the style; sliders call it inside a gesture. */
export function setCaptionStyle(clipId: string, patch: Partial<CaptionStyle>, label: EditLabel = 'history.captionStyle'): void {
  editCaptions(clipId, label, (l) => void Object.assign(l.style, patch));
}

/** Moves the captions to `y` (0 top, 1 bottom) at `time`; inside a gesture while dragging. */
export function moveCaptions(clipId: string, time: number, y: number): void {
  editCaptions(clipId, 'history.moveCaptions', (l) => void (l.y = editAt(l.y, time, Math.min(1, Math.max(0, y)), sourceRate())));
}

export function addCaptionKey(clipId: string, time: number): void {
  // At the place they're shown, which in Split isn't always what the keys say.
  editCaptions(clipId, 'history.addKeyframe', (l, clip) => void (l.y = setKey(l.y, time, captionYAt(l.y, videoLayerOf(clip).layout, time), sourceRate())));
}

export function deleteCaptionKey(clipId: string, index: number): void {
  editCaptions(clipId, 'history.deleteKeyframe', (l) => void (l.y = removeKey(l.y, index)));
}

export function setCaptionKeySmooth(clipId: string, index: number, smooth: boolean): void {
  editCaptions(clipId, 'history.smoothKeyframe', (l) => {
    const key = l.y[index];
    if (key) key.ease = smooth ? 'smooth' : 'cut';
  });
}
