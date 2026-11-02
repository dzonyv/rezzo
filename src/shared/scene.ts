/**
 * What a clip looks like at one moment, as a list of things to draw in
 * order: the framed source video, layers over it, the captions. The
 * preview and the export both draw from this list, so they can't differ;
 * the preview also uses it to find which layer is under the pointer.
 *
 * Quads are in output pixels, origin top left, rotation clockwise.
 */
import type { Asset } from './assets.ts';
import { frameRecipe, OUTPUT, type FrameRecipe, type Size } from './framing.ts';
import { layerTransformAt, type Transform } from './motion.ts';
import { videoLayerOf, type Clip, type TimedLayer } from './project.ts';

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
  | { type: 'image'; layerId: string; assetId: string; quad: Quad; opacity: number }
  | { type: 'captions' };

/** Whether a timed layer shows at source time `t`. */
export const showsAt = (layer: Pick<TimedLayer, 'start' | 'end'>, t: number): boolean => t >= layer.start - 1e-6 && t < layer.end - 1e-6;

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
 * whose asset isn't in `assets`, or that are fully transparent, are left out.
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
      if (!asset) continue;
      const transform = layerTransformAt(layer, t);
      if (transform.opacity <= 0 || transform.scale <= 0) continue;
      ops.push({ type: 'image', layerId: layer.id, assetId: asset.id, quad: quadOf(transform, asset), opacity: transform.opacity });
    }
  }
  return ops;
}
