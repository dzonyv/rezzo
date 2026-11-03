/**
 * Images for layers, read once per file and shared by the preview and the
 * export. They're decoded premultiplied (what the compositor blends) and,
 * when huge, scaled down to MAX_IMAGE_SIDE on the longer side.
 */
import { MAX_IMAGE_SIDE, type AssetFile, type ImageAsset } from '../../../shared/assets.ts';
import { FileCache } from './file-cache.ts';

/** Decodes the image at `url`, turned the way its EXIF data says. */
export async function decodeImage(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`reading the image failed: ${response.status}`);
  const blob = await response.blob();
  const full = await createImageBitmap(blob, { imageOrientation: 'from-image', premultiplyAlpha: 'premultiply' });
  const side = Math.max(full.width, full.height);
  if (side <= MAX_IMAGE_SIDE) return full;
  const f = MAX_IMAGE_SIDE / side;
  const small = await createImageBitmap(full, {
    resizeWidth: Math.max(1, Math.round(full.width * f)),
    resizeHeight: Math.max(1, Math.round(full.height * f)),
    resizeQuality: 'high',
    premultiplyAlpha: 'premultiply',
  });
  full.close();
  return small;
}

const images = new FileCache<ImageBitmap>(decodeImage, (image) => image.close());

/** The asset's picture; rejects when the file isn't there any more (see FileCache.load). */
export const loadImage = (asset: ImageAsset): Promise<ImageBitmap> => images.load(asset);

/** Lets go of every image except those of `files` (the open project's assets). */
export const keepOnlyImages = (files: readonly AssetFile[]): void => images.keepOnly(files);

/** Puts an image just decoded (when adding it) where loadImage will find it. */
export const keepImage = (file: AssetFile, image: ImageBitmap): void => images.put(file, image);
