/**
 * What a clip looks like at one moment, as a list of things to draw in
 * order: the framed source video, layers over it, the captions. The
 * preview and the export both draw from this list, so they can't differ;
 * the preview also uses it to find which layer is under the pointer.
 *
 * Quads are in output pixels, origin top left, rotation clockwise.
 */
import type { Asset } from './assets.ts';
import type { ChromaKey } from './chroma-key.ts';
import { frameRecipe, OUTPUT, type FrameRecipe, type Size } from './framing.ts';
import { layerTransformAt, type Transform } from './motion.ts';
import { ASSET_KIND_OF, videoLayerOf, type Clip, type OverlayLayer, type TimedLayer } from './project.ts';

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
  | { type: 'captions' };

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
 * whose asset isn't in `assets` (or isn't of their kind), or that are fully
 * transparent, are left out.
 */
export function sceneAt(clip: Clip, assets: readonly Asset[], t: number, source: Size): SceneOp[] {
  const ops: SceneOp[] = [];
  for (const layer of clip.layers) {
    if (layer.kind === 'video') {
      ops.push({ type: 'video', recipe: frameRecipe(videoLayerOf(clip), t, source) });
    } else if (layer.kind === 'caption') {
      ops.push({ type: 'captions' });
    } else if (showsAt(layer, t)) {
      const asset = assets.find((a) => a.id === layer.assetId);
      if (asset?.kind !== ASSET_KIND_OF[layer.kind]) continue;
      const transform = layerTransformAt(layer, t);
      if (transform.opacity <= 0 || transform.scale <= 0) continue;
      const op = { layerId: layer.id, assetId: asset.id, quad: quadOf(transform, asset), opacity: transform.opacity, key: layer.key };
      if (layer.kind === 'image') ops.push({ type: 'image', ...op });
      else if (asset.kind === 'video') ops.push({ type: 'overlay', ...op, time: overlayTimeAt(layer, asset.duration, t) });
    }
  }
  return ops;
}
