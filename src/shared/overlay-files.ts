/**
 * Planning the working files of video layers. Like a clip's working file,
 * a video layer's file is converted once into H.264 the WebCodecs decoder
 * handles, at the clip's frame rate so a layer frame lines up with a clip
 * frame. A file with alpha is "stacked": colour in the top half, alpha as
 * brightness in the bottom half (spikes/REPORT.md, Phase 3 checks).
 */
import type { VideoAsset } from './assets.ts';
import { OUTPUT, type Size } from './framing.ts';
import { MAX_CLIP_SECONDS, type OverlayLayer } from './project.ts';

/** Bumped when the conversion changes, so old cached files aren't reused. */
export const OVERLAY_VERSION = 1;

/**
 * Video layers showing at the same moment. Four full-size ones play at
 * 30 fps with room to spare on a GTX 1660; six already run late
 * (spikes/REPORT.md, Phase 3 checks).
 */
export const MAX_VIDEO_LAYERS = 4;

/**
 * The size a video layer is converted at: shrunk to fit the output frame,
 * never enlarged, even on both sides. The export is 1080 wide, so a layer
 * never needs more, and decoding cost goes with the number of pixels.
 */
export function overlaySize(size: Size): Size {
  const scale = Math.min(1, OUTPUT.width / size.width, OUTPUT.height / size.height);
  const even = (n: number) => Math.max(2, 2 * Math.round(n / 2));
  return { width: even(size.width * scale), height: even(size.height * scale) };
}

/**
 * Rows per half of a stacked file: the alpha half starts on a 16-row
 * macroblock boundary, with at least two black rows above it. Without them
 * the GPU blends chroma across the seam and the first alpha row picks up
 * colour.
 */
export const stackedHalf = (height: number): number => Math.ceil((height + 2) / 16) * 16;

/** Where the picture is in a video layer's working file. */
export interface OverlayLayout {
  /** The picture's size, which is the top of the file. */
  width: number;
  height: number;
  /** Rows of the whole file. */
  codedHeight: number;
  /** First row of the alpha half, or null for a file without alpha. */
  alphaAt: number | null;
}

export function overlayLayout(asset: Pick<VideoAsset, 'width' | 'height' | 'alpha'>): OverlayLayout {
  const { width, height } = overlaySize(asset);
  if (!asset.alpha) return { width, height, codedHeight: height, alphaAt: null };
  const half = stackedHalf(height);
  return { width, height, codedHeight: 2 * half, alphaAt: half };
}

/**
 * The seconds of the file a layer shows. A file no longer than the
 * longest clip is converted whole, so trimming or sliding the layer never
 * needs a new conversion; a longer one only for the part the layer plays,
 * unless the layer loops past its end and needs all of it.
 */
export function overlayRange(
  layer: Pick<OverlayLayer, 'start' | 'end' | 'offset' | 'loop'>,
  asset: Pick<VideoAsset, 'duration'>,
): { start: number; end: number } {
  const whole = { start: 0, end: asset.duration };
  const end = layer.offset + (layer.end - layer.start);
  if (asset.duration <= MAX_CLIP_SECONDS || (layer.loop && end > asset.duration)) return whole;
  return { start: Math.min(layer.offset, asset.duration), end: Math.min(end, asset.duration) };
}
