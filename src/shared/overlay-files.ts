/**
 * Planning the working files of video layers. Like a clip's working file,
 * a video layer's file is converted once into H.264 the WebCodecs decoder
 * handles, at the clip's frame rate so a layer frame lines up with a clip
 * frame. A file with alpha is "stacked": colour in the top half, alpha as
 * brightness in the bottom half (spikes/REPORT.md, Phase 3 checks).
 */
import type { Asset, VideoAsset } from './assets.ts';
import { OUTPUT, type Size } from './framing.ts';
import { MAX_CLIP_SECONDS, type Clip, type OverlayLayer } from './project.ts';
import { showsAt } from './scene.ts';
import { keptLength, outputTime, type ClipSpan } from './skips.ts';

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

/** A stretch of a video layer's sound: `duration` seconds from `from` seconds into its file, heard from source time `at`. */
export interface SoundPiece {
  at: number;
  from: number;
  duration: number;
}

/**
 * When a video layer's sound plays inside `range` (the clip): from where
 * the layer starts in its file, starting over at the end when it loops,
 * stopping at the end otherwise (the picture holds its last frame, the
 * sound doesn't go on).
 */
export function overlaySoundPieces(
  layer: Pick<OverlayLayer, 'start' | 'end' | 'offset' | 'loop'>,
  duration: number,
  range: { start: number; end: number },
): SoundPiece[] {
  const pieces: SoundPiece[] = [];
  const end = Math.min(layer.end, range.end);
  let t = Math.max(layer.start, range.start);
  // Sounds shorter than this are rounding, not sound.
  const tiny = 1e-4;
  while (end - t > tiny && duration > tiny) {
    let from = layer.offset + (t - layer.start);
    if (layer.loop) from %= duration;
    if (duration - from <= tiny) {
      if (!layer.loop) break;
      from = 0;
    }
    const length = Math.min(end - t, duration - from);
    pieces.push({ at: t, from, duration: length });
    t += length;
  }
  return pieces;
}

/**
 * A video layer's sound in `clip`, with `at` in output time: a layer plays
 * on through the clip's skips, as it does on screen.
 */
export function clipSoundPieces(clip: ClipSpan, layer: Pick<OverlayLayer, 'start' | 'end' | 'offset' | 'loop'>, duration: number): SoundPiece[] {
  const played = { ...layer, start: outputTime(clip, layer.start), end: outputTime(clip, layer.end) };
  return overlaySoundPieces(played, duration, { start: 0, end: keptLength(clip) });
}

/**
 * Video layers that are left out for some of their time because
 * MAX_VIDEO_LAYERS lower ones already show then: the renderer draws the
 * lowest ones (render/layer-frames.ts).
 */
export function videoLayersOverLimit(clip: Pick<Clip, 'layers'>): Set<string> {
  const videos = clip.layers.filter((l) => l.kind === 'overlay');
  const over = new Set<string>();
  for (const layer of videos) {
    // The set of layers showing only changes where one starts.
    const moments = [layer.start, ...videos.map((v) => v.start).filter((t) => t > layer.start && t < layer.end)];
    for (const t of moments) {
      const below = videos.filter((v) => showsAt(v, t));
      if (below.indexOf(layer) >= MAX_VIDEO_LAYERS) {
        over.add(layer.id);
        break;
      }
    }
  }
  return over;
}

/** The clip's video layers with their files, bottom first; a layer whose file isn't a video in `assets` is left out. */
export function videoLayersOf(clip: Pick<Clip, 'layers'>, assets: readonly Asset[]): { layer: OverlayLayer; asset: VideoAsset }[] {
  return clip.layers.flatMap((layer) => {
    if (layer.kind !== 'overlay') return [];
    const asset = assets.find((a) => a.id === layer.assetId);
    return asset?.kind === 'video' ? [{ layer, asset }] : [];
  });
}
