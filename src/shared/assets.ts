/**
 * Files a project uses besides its source video: images now, videos and
 * animations later. Like the source they're referenced by path and
 * fingerprint, never copied, so moving one means finding it again.
 */
import { z } from 'zod';

export const ASSET_KINDS = ['image'] as const;
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;
/** Larger than any image anyone puts in a clip; keeps a mistaken pick from being read into memory. */
export const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
/** Images are drawn from a texture at most this many pixels on the longer side. */
export const MAX_IMAGE_SIDE = 4096;

const fingerprint = z.string().regex(/^[0-9a-f]{64}$/);

/** A file as the main process found it, before the page has read it. */
export const assetFileSchema = z.object({
  /** Absolute path when it was added or last found. */
  path: z.string().min(1),
  /** The file name, for showing. */
  name: z.string(),
  size: z.number().int().nonnegative(),
  /** See workers/media/fingerprint.ts. */
  fingerprint,
});
export type AssetFile = z.infer<typeof assetFileSchema>;

export const imageAssetSchema = assetFileSchema.extend({
  id: z.uuid(),
  kind: z.literal('image'),
  /** As drawn: after turning it the way its EXIF data says. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type ImageAsset = z.infer<typeof imageAssetSchema>;

export const assetSchema = z.discriminatedUnion('kind', [imageAssetSchema]);
export type Asset = z.infer<typeof assetSchema>;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** "changed": the file is there, but its size differs from when it was added. */
export type AssetStatus = 'ok' | 'missing' | 'changed';
