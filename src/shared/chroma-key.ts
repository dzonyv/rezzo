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
