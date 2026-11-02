/**
 * Lottie animations as layers: what the app needs to know about a file
 * (checked in the main process before it's used), which frame of the
 * animation shows at a moment, and how large it's rendered. All pure, so
 * the preview and the export agree.
 */
import { z } from 'zod';
import type { Size } from './framing.ts';

/** Animations are JSON read into memory whole; this only catches a wrong pick. */
export const MAX_LOTTIE_BYTES = 50 * 1024 * 1024;
/** Rendered at most this many pixels on the longer side. */
export const MAX_LOTTIE_SIDE = 2048;
const MIN_LOTTIE_SIDE = 16;

export const lottieInfoSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Frames per second the animation was made at. */
  frameRate: z.number().finite().positive(),
  /** Frames from its in point to its out point. */
  frames: z.number().finite().positive(),
});
export type LottieInfo = z.infer<typeof lottieInfoSchema>;

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * What a Lottie animation's JSON says about itself, or null when it isn't
 * one. "external-images": it shows image files kept next to it, which
 * aren't read; a .lottie package (`packaged`) carries its images inside.
 */
export function lottieInfo(json: unknown, { packaged = false } = {}): LottieInfo | 'external-images' | null {
  if (typeof json !== 'object' || json === null) return null;
  const d = json as Record<string, unknown>;
  const { fr, ip, op, w, h } = d;
  if (typeof d['v'] !== 'string' || !positive(fr) || !positive(w) || !positive(h) || typeof ip !== 'number' || typeof op !== 'number' || !(op > ip)) return null;
  if (!Array.isArray(d['layers'])) return null;
  if (!packaged && Array.isArray(d['assets'])) {
    const external = d['assets'].some((a: unknown) => {
      const asset = a as { p?: unknown; e?: unknown; layers?: unknown } | null;
      return typeof asset?.p === 'string' && asset.layers === undefined && asset.e !== 1 && !asset.p.startsWith('data:');
    });
    if (external) return 'external-images';
  }
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)), frameRate: fr, frames: op - ip };
}

/** Seconds the animation runs at its own speed. */
export const lottieSeconds = (info: LottieInfo): number => info.frames / info.frameRate;

/**
 * The animation's frame (from its in point, fractional) at source time `t`
 * for a layer starting at `start` and playing at `speed`: it starts over
 * at the end when it loops, otherwise its last frame stays up.
 */
export function lottieFrameAt(layer: { start: number; speed: number; loop: boolean }, info: Pick<LottieInfo, 'frameRate' | 'frames'>, t: number): number {
  const frame = Math.max(0, t - layer.start) * layer.speed * info.frameRate;
  const last = Math.max(0, info.frames - 1);
  if (layer.loop) return info.frames > 0 ? frame % info.frames : 0;
  return Math.min(frame, last);
}

/**
 * How large to render an animation drawn `drawnWidth` output pixels wide:
 * its own size scaled in quarter-octave steps, so it's always sharp but is
 * only rendered at a new size when its size on screen changes noticeably.
 */
export function lottieRenderSize(info: Size, drawnWidth: number): Size {
  const want = Math.max(drawnWidth, 1) / info.width;
  const most = MAX_LOTTIE_SIDE / Math.max(info.width, info.height);
  const least = MIN_LOTTIE_SIDE / Math.min(info.width, info.height);
  const scale = Math.min(most, Math.max(least, 2 ** (Math.ceil(Math.log2(want) * 4 - 1e-9) / 4)));
  return { width: Math.max(1, Math.round(info.width * scale)), height: Math.max(1, Math.round(info.height * scale)) };
}
