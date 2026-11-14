/**
 * What a clip looks like at one moment, as a list of things to draw in
 * order: the framed source video, layers over it (pictures, text, and
 * effects that change what's under them), the captions. The
 * preview and the export both draw from this list, so they can't differ;
 * the preview also uses it to find which layer is under the pointer.
 *
 * Quads are in output pixels, origin top left, rotation clockwise.
 */
import type { Asset } from './assets.ts';
import type { ChromaKey } from './chroma-key.ts';
import { effectPassAt, type EffectPass } from './effects.ts';
import { frameRecipe, OUTPUT, type FrameRecipe, type Size } from './framing.ts';
import { lottieFrameAt, lottieRenderSize } from './lottie.ts';
import { layerTransformAt, type Transform } from './motion.ts';
import { ASSET_KIND_OF, videoLayerOf, type Clip, type OverlayLayer, type TimedLayer } from './project.ts';
import { layerClock } from './skips.ts';

export interface Quad {
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Radians, clockwise. */
  rotation: number;
}

export type SceneOp =
  | { type: 'video'; recipe: FrameRecipe }
  | { type: 'image'; layerId: string; assetId: string; quad: Quad; opacity: number; key: ChromaKey | null }
  /** `time`: seconds into the video file (overlayTimeAt). */
  | { type: 'overlay'; layerId: string; assetId: string; quad: Quad; opacity: number; key: ChromaKey | null; time: number }
  /** `frame`: the animation's frame (lottieFrameAt); `size`: what it's rendered at (lottieRenderSize). */
  | { type: 'lottie'; layerId: string; assetId: string; quad: Quad; opacity: number; frame: number; size: Size }
  /** A text layer's picture, painted by render/text.ts. */
  | { type: 'text'; layerId: string; quad: Quad; opacity: number }
  | { type: 'effect'; layerId: string; pass: EffectPass }
  | { type: 'captions' };

const NO_TEXTS: ReadonlyMap<string, { size: Size }> = new Map();

/** Whether a timed layer shows at source time `t`. */
export const showsAt = (layer: Pick<TimedLayer, 'start' | 'end'>, t: number): boolean => t >= layer.start - 1e-6 && t < layer.end - 1e-6;

/**
 * Seconds into its file a video layer shows at source time `t`: from
 * `offset` on, starting over at the end when it loops and holding the end
 * otherwise (the frame lookup turns that into the last frame).
 */
export function overlayTimeAt(layer: Pick<OverlayLayer, 'start' | 'offset' | 'loop'>, duration: number, t: number): number {
  const time = layer.offset + Math.max(0, t - layer.start);
  if (layer.loop && duration > 0) return time % duration;
  return Math.min(time, duration);
}

/** Where a layer of this picture size lands with this transform. */
export function quadOf(transform: Transform, size: Size, out: Size = OUTPUT): Quad {
  const w = transform.scale * out.width;
  return {
    cx: transform.x * out.width,
    cy: transform.y * out.height,
    w,
    h: (w * size.height) / size.width,
    rotation: (transform.rotation * Math.PI) / 180,
  };
}

/**
 * Where a text layer whose picture is `size` (output pixels at size 1)
 * lands with this transform: its scale multiplies the picture's own size,
 * rather than being a share of the output width as for a file.
 */
export function textQuadOf(transform: Transform, size: Size, out: Size = OUTPUT): Quad {
  return quadOf({ ...transform, scale: (transform.scale * size.width) / OUTPUT.width }, size, out);
}

/** The quad's corners: top left, top right, bottom right, bottom left. */
export function quadCorners(q: Quad): [number, number][] {
  const cos = Math.cos(q.rotation);
  const sin = Math.sin(q.rotation);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => {
    const dx = (sx! * q.w) / 2;
    const dy = (sy! * q.h) / 2;
    return [q.cx + dx * cos - dy * sin, q.cy + dx * sin + dy * cos] as [number, number];
  });
}

/** Whether the output point (px, py) is inside the quad. */
export function quadContains(q: Quad, px: number, py: number): boolean {
  const cos = Math.cos(-q.rotation);
  const sin = Math.sin(-q.rotation);
  const dx = px - q.cx;
  const dy = py - q.cy;
  const x = dx * cos - dy * sin;
  const y = dx * sin + dy * cos;
  return Math.abs(x) <= q.w / 2 && Math.abs(y) <= q.h / 2;
}

/**
 * Everything to draw for `clip` at source time `t`, bottom first. Layers
 * whose asset isn't in `assets` (or isn't of their kind), text layers whose
 * picture isn't in `texts` (by layer id; not painted yet, or empty),
 * and layers that are fully transparent are left out.
 */
export function sceneAt(clip: Clip, assets: readonly Asset[], t: number, source: Size, texts: ReadonlyMap<string, { size: Size }> = NO_TEXTS): SceneOp[] {
  const ops: SceneOp[] = [];
  for (const layer of clip.layers) {
    if (layer.kind === 'video') {
      ops.push({ type: 'video', recipe: frameRecipe(videoLayerOf(clip), t, source) });
    } else if (layer.kind === 'caption') {
      ops.push({ type: 'captions' });
    } else if (!showsAt(layer, t)) {
      continue;
    } else if (layer.kind === 'sound') {
      continue;
    } else if (layer.kind === 'effect') {
      const pass = effectPassAt(layer, t);
      if (pass) ops.push({ type: 'effect', layerId: layer.id, pass });
    } else if (layer.kind === 'text') {
      const size = texts.get(layer.id)?.size;
      if (!size) continue;
      const transform = layerTransformAt(layer, t);
      if (transform.opacity <= 0 || transform.scale <= 0) continue;
      ops.push({ type: 'text', layerId: layer.id, quad: textQuadOf(transform, size), opacity: transform.opacity });
    } else {
      const asset = assets.find((a) => a.id === layer.assetId);
      if (asset?.kind !== ASSET_KIND_OF[layer.kind]) continue;
      const transform = layerTransformAt(layer, t);
      if (transform.opacity <= 0 || transform.scale <= 0) continue;
      const op = { layerId: layer.id, assetId: asset.id, quad: quadOf(transform, asset), opacity: transform.opacity };
      if (layer.kind === 'image') ops.push({ type: 'image', ...op, key: layer.key });
      else if (layer.kind === 'overlay' && asset.kind === 'video') ops.push({ type: 'overlay', ...op, key: layer.key, time: overlayTimeAt(layer, asset.duration, layerClock(clip, layer.start, t)) });
      else if (layer.kind === 'lottie' && asset.kind === 'lottie') {
        ops.push({ type: 'lottie', ...op, frame: lottieFrameAt(layer, asset, layerClock(clip, layer.start, t)), size: lottieRenderSize(asset, op.quad.w) });
      }
    }
  }
  return ops;
}
