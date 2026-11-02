/**
 * Green screen: pixels close to one colour become transparent. Works the
 * same on video and image layers, since both are drawn by the same shader.
 */
import { z } from 'zod';

const unit = z.number().min(0).max(1);

export const chromaKeySchema = z.object({
  /** The colour to remove, "#rrggbb". */
  color: z.string().regex(/^#[0-9a-f]{6}$/),
  /** How far from `color` (in chroma) a pixel may be and still go fully transparent. */
  similarity: unit,
  /** How wide the fade from transparent to opaque is past `similarity`. */
  smoothness: unit,
  /** How much of the key colour's tint is taken out of what stays (green fringes). */
  spill: unit,
});
export type ChromaKey = z.infer<typeof chromaKeySchema>;

/** A starting point for an ordinary green screen. */
export const DEFAULT_CHROMA_KEY: ChromaKey = { color: '#00ff00', similarity: 0.3, smoothness: 0.1, spill: 0.5 };

/** BT.709 luma weights; the same ones the export's YUV conversion uses. */
const KR = 0.2126;
const KG = 0.7152;
const KB = 0.0722;

/** Colour difference (Cb, Cr) of an RGB colour in 0..1, each in -0.5..0.5. */
export function chromaOf(r: number, g: number, b: number): [number, number] {
  const y = KR * r + KG * g + KB * b;
  return [(b - y) / 1.8556, (r - y) / 1.5748];
}

/** "#rrggbb" as RGB in 0..1. */
export function rgbOf(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * What the key does to one pixel (straight RGB in 0..1): how much of it
 * stays (`alpha`, 0..1) and its colour with the key's tint taken out. The
 * distance is between colour differences, so a shadow on the screen keys
 * like the lit part; it's scaled so the farthest two colours are 1 apart,
 * as in FFmpeg's chromakey. The compositor's shader does the same sums
 * (render/compositor.ts, PREP); this is the version the tests check.
 */
export function applyChromaKey(rgb: readonly [number, number, number], key: ChromaKey): { alpha: number; rgb: [number, number, number] } {
  const [r, g, b] = rgb;
  const [kcb, kcr] = chromaOf(...rgbOf(key.color));
  let [cb, cr] = chromaOf(r, g, b);
  const distance = Math.hypot(cb - kcb, cr - kcr) / Math.SQRT2;
  const alpha =
    key.smoothness > 0 ? Math.min(1, Math.max(0, (distance - key.similarity) / key.smoothness)) : distance < key.similarity ? 0 : 1;

  // Spill: the part of the colour difference that points the key's way is taken out, brightness kept.
  const length = Math.hypot(kcb, kcr);
  if (length > 0 && key.spill > 0) {
    const toward = (cb * kcb + cr * kcr) / length;
    if (toward > 0) {
      cb -= (kcb / length) * toward * key.spill;
      cr -= (kcr / length) * toward * key.spill;
    }
  }
  const y = KR * r + KG * g + KB * b;
  const nr = y + 1.5748 * cr;
  const nb = y + 1.8556 * cb;
  const ng = (y - KR * nr - KB * nb) / KG;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { alpha, rgb: [clamp(nr), clamp(ng), clamp(nb)] };
}
