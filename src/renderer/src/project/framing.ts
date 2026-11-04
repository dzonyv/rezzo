/**
 * Edits to a clip's framing. Each takes the time on screen: while a value
 * has one keyframe the edit changes it for the whole clip, after that it
 * lands on a keyframe at that time (see editAt in shared/framing.ts).
 */
import type { Draft } from 'immer';
import type { ClipAnalysis } from '../../../shared/analysis.ts';
import { autoFrame, withAutoFrame, type AutoFrameOptions } from '../../../shared/autoframe.ts';
import { editAt, removeKey, setKey, setLayoutAt, valueAt } from '../../../shared/framing.ts';
import { fps, workingFrameRate } from '../../../shared/frames.ts';
import type { Animated, Crop, FullFrame, Layout, VideoLayer } from '../../../shared/project.ts';
import type { Stretch } from '../../../shared/speakers.ts';
import type { Span } from '../../../shared/voices.ts';
import { projectStore, type EditLabel } from './store.ts';

/** The framing values a user edits; `layout` is edited only through setLayout. */
export type FramingProperty = 'follow' | 'splitTop' | 'splitBottom' | 'full';

function editLayer(clipId: string, label: EditLabel, recipe: (layer: Draft<VideoLayer>) => void): void {
  projectStore.getState().edit(label, (d) => {
    const layer = d.clips.find((c) => c.id === clipId)?.layers.find((l) => l.kind === 'video');
    if (layer) recipe(layer);
  });
}

/** The frame grid of the open project's source, which keyframe edits snap to. */
export function sourceRate() {
  const source = projectStore.getState().project?.source;
  if (!source) throw new Error('no source');
  return workingFrameRate(source);
}

export function setLayout(clipId: string, time: number, layout: Layout): void {
  editLayer(clipId, 'history.changeLayout', (l) => void (l.layout = setLayoutAt(l.layout, time, layout, sourceRate())));
}

/** Sets a crop or full-frame value at `time`; used while dragging or zooming, inside a gesture. */
export function setFraming(clipId: string, label: EditLabel, property: FramingProperty, time: number, value: Crop | FullFrame): void {
  editLayer(clipId, label, (l) => {
    const keys = l[property] as Animated<Crop | FullFrame>;
    (l[property] as Animated<Crop | FullFrame>) = editAt(keys, time, value, sourceRate());
  });
}

/** Adds a keyframe at `time` holding the value there, so later edits can differ from it. */
export function addKeyframe(clipId: string, property: FramingProperty, time: number): void {
  editLayer(clipId, 'history.addKeyframe', (l) => {
    const keys = l[property] as Animated<Crop | FullFrame>;
    (l[property] as Animated<Crop | FullFrame>) = setKey(keys, time, valueAt(keys, time), sourceRate());
  });
}

export function deleteKeyframe(clipId: string, property: FramingProperty, index: number): void {
  editLayer(clipId, 'history.deleteKeyframe', (l) => {
    (l[property] as Animated<Crop | FullFrame>) = removeKey(l[property] as Animated<Crop | FullFrame>, index);
  });
}

/** Whether keyframe `index` eases over to the next one or holds until it. */
export function setSmooth(clipId: string, property: FramingProperty, index: number, smooth: boolean): void {
  editLayer(clipId, 'history.smoothKeyframe', (l) => {
    const key = l[property][index];
    if (key) key.ease = smooth ? 'smooth' : 'cut';
  });
}

/** Frames `range` of the clip from who talks, in place of the framing and layouts there. One undo step. */
export function applyAutoFrame(clipId: string, analysis: ClipAnalysis, stretches: readonly Stretch[], range: Span, options: AutoFrameOptions): void {
  const clip = projectStore.getState().project?.clips.find((c) => c.id === clipId);
  if (!clip) return;
  const rate = sourceRate();
  const span = { start: Math.max(range.start, clip.start, analysis.start), end: Math.min(range.end, clip.end, analysis.end) };
  if (span.end <= span.start) return;
  const framed = autoFrame(analysis, stretches, span, options, rate);
  const toEnd = span.end >= clip.end - 1 / fps(rate);
  editLayer(clipId, 'history.autoFrame', (l) => void Object.assign(l, withAutoFrame(l, framed, span, toEnd, rate)));
}
