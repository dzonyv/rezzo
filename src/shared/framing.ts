/**
 * Framing: what part of the source ends up where in the 9:16 output at a
 * given moment. Pure functions shared by the preview and the export, so
 * both draw exactly the same thing.
 *
 * Source rectangles are normalised (0..1 across and down the source);
 * output rectangles are in output pixels. Both have their origin top left.
 */
import { sameFrame, snapToFrame, type FrameRate } from './frames.ts';
import type { Animated, Crop, FullFrame, Key, Layout, VideoLayer } from './project.ts';

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Draw {
  src: Rect;
  dst: Rect;
}

export interface FrameRecipe {
  layout: Layout;
  /** "blur": fill the output with a blurred copy of the whole source first. */
  background: 'blur' | null;
  draws: Draw[];
}

export const OUTPUT: Size = { width: 1080, height: 1920 };

/** The output areas each layout's crops fill. */
export function regions(layout: Layout, out: Size = OUTPUT): Rect[] {
  const whole = { x: 0, y: 0, w: out.width, h: out.height };
  if (layout !== 'split') return [whole];
  const half = out.height / 2;
  return [
    { x: 0, y: 0, w: out.width, h: half },
    { x: 0, y: half, w: out.width, h: half },
  ];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smoothstep = (f: number) => f * f * (3 - 2 * f);

function mix<T>(a: T, b: T, f: number): T {
  if (typeof a === 'number' && typeof b === 'number') return (a + (b - a) * f) as T;
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(a)) out[k] = mix(v, (b as Record<string, unknown>)[k], f);
    return out as T;
  }
  // Anything that can't be blended (a layout) changes at the next keyframe.
  return a;
}

/** Index of the last keyframe at or before `t`, or -1 before the first. */
function keyBefore<T>(keys: Animated<T>, t: number): number {
  let lo = 0;
  let hi = keys.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid]!.t <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** The value at time `t`. Before the first keyframe it is the first one's value. */
export function valueAt<T>(keys: Animated<T>, t: number): T {
  const i = keyBefore(keys, t);
  if (i < 0) return keys[0]!.value;
  const a = keys[i]!;
  const b = keys[i + 1];
  if (!b || a.ease === 'cut') return a.value;
  return mix(a.value, b.value, smoothstep(clamp((t - a.t) / (b.t - a.t), 0, 1)));
}

/** Index of the keyframe on the same frame as `t`, or -1. */
export function keyAt<T>(keys: Animated<T>, t: number, rate: FrameRate): number {
  return keys.findIndex((k) => sameFrame(k.t, t, rate));
}

/**
 * Puts a keyframe at `t` (snapped to a frame), replacing one already on
 * that frame. A new keyframe eases the way the one before it does, so
 * adding a point to a smooth move keeps the move smooth.
 */
export function setKey<T>(keys: Animated<T>, t: number, value: T, rate: FrameRate): Animated<T> {
  const at = keyAt(keys, t, rate);
  if (at >= 0) return keys.map((k, i) => (i === at ? { ...k, value } : k));
  const time = snapToFrame(t, rate);
  const before = keyBefore(keys, time);
  const key: Key<T> = { t: time, value, ease: before >= 0 ? keys[before]!.ease : 'cut' };
  return [...keys.slice(0, before + 1), key, ...keys.slice(before + 1)];
}

/**
 * An edit made at `t`. While a value has a single keyframe it doesn't
 * change over time, so the edit applies to the whole clip; once it has
 * more, the edit lands on a keyframe at `t`.
 */
export function editAt<T>(keys: Animated<T>, t: number, value: T, rate: FrameRate): Animated<T> {
  if (keys.length === 1) return [{ ...keys[0]!, value }];
  return setKey(keys, t, value, rate);
}

/** Removes keyframe `index`; the last one stays. */
export function removeKey<T>(keys: Animated<T>, index: number): Animated<T> {
  if (keys.length <= 1) return keys;
  return keys.filter((_, i) => i !== index);
}

/**
 * The size of a crop with output aspect `aspect` (width / height) at zoom
 * 1 in normalised source units: as large as fits in the source.
 */
function fullCropSize(aspect: number, source: Size): { w: number; h: number } {
  const sourceAspect = source.width / source.height;
  return sourceAspect > aspect ? { w: aspect / sourceAspect, h: 1 } : { w: 1, h: sourceAspect / aspect };
}

/** Where `crop` reads from in the source, kept inside the frame. */
export function cropRect(crop: Crop, aspect: number, source: Size): Rect {
  const full = fullCropSize(aspect, source);
  const w = full.w / crop.zoom;
  const h = full.h / crop.zoom;
  return { x: clamp(crop.x - w / 2, 0, 1 - w), y: clamp(crop.y - h / 2, 0, 1 - h), w, h };
}

/**
 * The same crop with its centre moved to where it actually reads from.
 * Edits store this, so dragging past the edge and back responds at once.
 */
export function clampCrop(crop: Crop, aspect: number, source: Size): Crop {
  const r = cropRect(crop, aspect, source);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2, zoom: crop.zoom };
}

/** Moves a crop by a drag of (dx, dy) output pixels across `region`. */
export function panCrop(crop: Crop, region: Rect, source: Size, dx: number, dy: number): Crop {
  const aspect = region.w / region.h;
  const r = cropRect(crop, aspect, source);
  return clampCrop({ x: r.x + r.w / 2 - (dx / region.w) * r.w, y: r.y + r.h / 2 - (dy / region.h) * r.h, zoom: crop.zoom }, aspect, source);
}

/**
 * Zooms a crop to `zoom`, keeping the source point under (px, py) output
 * pixels in `region` where it is.
 */
export function zoomCrop(crop: Crop, region: Rect, source: Size, zoom: number, px: number, py: number): Crop {
  const aspect = region.w / region.h;
  const before = cropRect(crop, aspect, source);
  const fx = (px - region.x) / region.w;
  const fy = (py - region.y) / region.h;
  const pointX = before.x + fx * before.w;
  const pointY = before.y + fy * before.h;
  const full = fullCropSize(aspect, source);
  const w = full.w / zoom;
  const h = full.h / zoom;
  return clampCrop({ x: pointX - fx * w + w / 2, y: pointY - fy * h + h / 2, zoom }, aspect, source);
}

/** Where the whole source lands in the Full layout, before clipping to the output. */
export function fullFrameRect(frame: FullFrame, source: Size, out: Size = OUTPUT): Rect {
  const w = out.width * frame.zoom;
  const h = (w * source.height) / source.width;
  const cy = out.height / 2 + (frame.y * (out.height - h)) / 2;
  return { x: (out.width - w) / 2, y: cy - h / 2, w, h };
}

/** Clips a draw to the output, cutting the same share off its source rectangle. */
function clipToOutput(draw: Draw, out: Size): Draw | null {
  const { src, dst } = draw;
  const x0 = Math.max(dst.x, 0);
  const y0 = Math.max(dst.y, 0);
  const x1 = Math.min(dst.x + dst.w, out.width);
  const y1 = Math.min(dst.y + dst.h, out.height);
  if (x1 <= x0 || y1 <= y0) return null;
  const sx = src.w / dst.w;
  const sy = src.h / dst.h;
  return {
    src: { x: src.x + (x0 - dst.x) * sx, y: src.y + (y0 - dst.y) * sy, w: (x1 - x0) * sx, h: (y1 - y0) * sy },
    dst: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
  };
}

/** What to draw for the video layer at time `t`. */
export function frameRecipe(layer: VideoLayer, t: number, source: Size, out: Size = OUTPUT): FrameRecipe {
  const layout = valueAt(layer.layout, t);
  if (layout === 'full') {
    const dst = fullFrameRect(valueAt(layer.full, t), source, out);
    const draw = clipToOutput({ src: { x: 0, y: 0, w: 1, h: 1 }, dst }, out);
    return { layout, background: 'blur', draws: draw ? [draw] : [] };
  }
  const crops = layout === 'follow' ? [layer.follow] : [layer.splitTop, layer.splitBottom];
  const draws = regions(layout, out).map((dst, i) => ({
    src: cropRect(valueAt(crops[i]!, t), dst.w / dst.h, source),
    dst,
  }));
  return { layout, background: null, draws };
}

/** The framing a new clip starts with: Follow, centred. */
export function defaultVideoLayer(t: number, id: string = crypto.randomUUID()): VideoLayer {
  const key = <T>(value: T): Animated<T> => [{ t, value, ease: 'cut' }];
  return {
    id,
    kind: 'video',
    layout: key<Layout>('follow'),
    follow: key({ x: 0.5, y: 0.5, zoom: 1 }),
    // Two people side by side: the left one on top, the right one below.
    splitTop: key({ x: 0.25, y: 0.5, zoom: 1 }),
    splitBottom: key({ x: 0.75, y: 0.5, zoom: 1 }),
    full: key({ y: 0, zoom: 1 }),
  };
}
