/**
 * The cutout: the people in the cover's picture drawn again over the
 * layers under it, so a title can sit behind them. MediaPipe's image
 * segmenter finds them (render/cutout.ts); this is what the document says
 * about it and where in the source it looks.
 */
import { z } from 'zod';
import type { Rect } from './framing.ts';

const color = z.string().regex(/^#[0-9a-f]{6}$/i);

/** Widest outline and glow, in output pixels. */
export const MAX_CUTOUT_OUTLINE = 40;
export const MAX_CUTOUT_GLOW = 120;

/** An outline round the people and a glow outside it; a width or size of 0 leaves it out. */
export const cutoutStyleSchema = z.object({
  outline: z.object({ color, width: z.number().min(0).max(MAX_CUTOUT_OUTLINE) }),
  glow: z.object({ color, size: z.number().min(0).max(MAX_CUTOUT_GLOW) }),
});
export type CutoutStyle = z.infer<typeof cutoutStyleSchema>;

/** A new cutout: a white outline, no glow. */
export const DEFAULT_CUTOUT_STYLE: CutoutStyle = {
  outline: { color: '#ffffff', width: 12 },
  glow: { color: '#ffd400', size: 0 },
};

/** Room left round what the picture shows, as a share of its size, so an outline at the edge has people to go round. */
const MARGIN = 0.08;
/** The region snaps out to this grid (a share of the source), so small framing changes reuse the people already found. */
const GRID = 1 / 16;
/** The longest side of the picture the segmenter gets; more only costs time, as it looks at 256×256. */
export const MASK_LONG_SIDE = 1024;

/**
 * The part of the source (texture coordinates, 0..1) to look for people
 * in: what the framing `shows` (its draws' source rectangles), with a margin,
 * snapped out to the grid.
 */
export function maskRegion(shows: readonly Rect[]): Rect {
  const x0 = Math.min(...shows.map((r) => r.x));
  const y0 = Math.min(...shows.map((r) => r.y));
  const x1 = Math.max(...shows.map((r) => r.x + r.w));
  const y1 = Math.max(...shows.map((r) => r.y + r.h));
  const mx = (x1 - x0) * MARGIN;
  const my = (y1 - y0) * MARGIN;
  const snap = (v: number, round: (n: number) => number) => Math.min(1, Math.max(0, round(v / GRID) * GRID));
  const x = snap(x0 - mx, Math.floor);
  const y = snap(y0 - my, Math.floor);
  return { x, y, w: snap(x1 + mx, Math.ceil) - x, h: snap(y1 + my, Math.ceil) - y };
}

/** Whether `outer` covers all of `inner`. */
export const covers = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x - 1e-9 && inner.y >= outer.y - 1e-9 && inner.x + inner.w <= outer.x + outer.w + 1e-9 && inner.y + inner.h <= outer.y + outer.h + 1e-9;

/** The size in pixels the segmenter gets `region` of a `source`-sized frame at: as it is, or smaller so the long side fits MASK_LONG_SIDE. */
export function maskSize(region: Rect, source: { width: number; height: number }): { width: number; height: number } {
  const w = region.w * source.width;
  const h = region.h * source.height;
  const scale = Math.min(1, MASK_LONG_SIDE / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}
