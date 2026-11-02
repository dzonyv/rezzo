/**
 * Files a project uses besides its source video: images, videos and Lottie
 * animations. Like the source they're referenced by path and fingerprint,
 * never copied, so moving one means finding it again.
 */
import { z } from 'zod';
import { lottieInfoSchema } from './lottie.ts';

export const ASSET_KINDS = ['image', 'video', 'lottie'] as const;
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'mkv', 'gif'] as const;
/** Lottie JSON, or a .lottie package (a zip with the JSON and its images). */
export const LOTTIE_EXTENSIONS = ['json', 'lottie'] as const;
/** Larger than any image anyone puts in a clip; keeps a mistaken pick from being read into memory. */
export const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
/** Videos are only read by FFmpeg, never into memory whole; this just catches a wrong pick. */
export const MAX_VIDEO_BYTES = 16 * 1024 * 1024 * 1024;
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

/** What ffprobe tells us about a video layer's file (workers/media/probe.ts). */
export const videoInfoSchema = z.object({
  codec: z.string(),
  /** As shown: after turning it the way its rotation tag says. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  duration: z.number().finite().positive(),
  /** Nominal frame rate as a fraction; the working file is converted to the clip's rate anyway. */
  frameRate: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  /** Colour matrix tag, or null when the file doesn't say. */
  colorSpace: z.string().nullable(),
  /** Has a transparent background (an alpha channel). */
  alpha: z.boolean(),
  hasAudio: z.boolean(),
});
export type VideoInfo = z.infer<typeof videoInfoSchema>;

export const videoAssetSchema = assetFileSchema.extend({ id: z.uuid(), kind: z.literal('video') }).extend(videoInfoSchema.shape);
export type VideoAsset = z.infer<typeof videoAssetSchema>;

/** A Lottie animation, with what its JSON says about it (shared/lottie.ts). */
export const lottieAssetSchema = assetFileSchema.extend({ id: z.uuid(), kind: z.literal('lottie') }).extend(lottieInfoSchema.shape);
export type LottieAsset = z.infer<typeof lottieAssetSchema>;

export const assetSchema = z.discriminatedUnion('kind', [imageAssetSchema, videoAssetSchema, lottieAssetSchema]);
export type Asset = z.infer<typeof assetSchema>;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** "changed": the file is there, but its size differs from when it was added. */
export type AssetStatus = 'ok' | 'missing' | 'changed';
