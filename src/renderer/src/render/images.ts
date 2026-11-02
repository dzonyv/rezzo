/**
 * Images for layers, read once per file and shared by the preview and the
 * export. They're decoded premultiplied (what the compositor blends) and,
 * when huge, scaled down to MAX_IMAGE_SIDE on the longer side.
 */
import { MAX_IMAGE_SIDE, type AssetFile, type ImageAsset } from '../../../shared/assets.ts';

const cache = new Map<string, Promise<ImageBitmap>>();
const key = (file: AssetFile) => `${file.fingerprint}:${file.path}`;

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

/**
 * The asset's picture; rejects when the file isn't there any more (moved,
 * deleted), even if it was read before, so the preview shows what the
 * export and the next start of the app will.
 */
export async function loadImage(asset: ImageAsset): Promise<ImageBitmap> {
  if ((await window.rezzo.invoke('asset:check', asset)) === 'missing') throw new Error(`${asset.path} is missing`);
  const k = key(asset);
  let loading = cache.get(k);
  if (!loading) {
    loading = window.rezzo.invoke('asset:url', asset).then(decodeImage);
    // A failure isn't kept: the file may be back (or found) next time.
    loading.catch(() => cache.delete(k));
    cache.set(k, loading);
  }
  return loading;
}

/** Puts an image just decoded (when adding it) where loadImage will find it. */
export function keepImage(file: AssetFile, image: ImageBitmap): void {
  cache.set(key(file), Promise.resolve(image));
}
