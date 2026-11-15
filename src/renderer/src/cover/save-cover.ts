/**
 * Saving a clip's cover: the cover drawn once, at 1080×1920, by the same
 * scene renderer as the preview and the export, from the open clip's
 * working file as its player has it read in (decoded apart from playback); then encoded as PNG, or as a JPG that fits MAX_JPG_BYTES,
 * and handed to the main process to write where the user says.
 */
import i18n from 'i18next';
import { coverClip, coverOf, MAX_JPG_BYTES, type CoverFormat } from '../../../shared/cover.ts';
import { OUTPUT } from '../../../shared/framing.ts';
import type { Asset } from '../../../shared/assets.ts';
import { layerAssetIds, type Clip } from '../../../shared/project.ts';
import { workingFrameIndex } from '../../../shared/working.ts';
import type { WorkingFile } from '../render/clip-player.ts';
import { Compositor } from '../render/compositor.ts';
import type { Demuxed } from '../render/demux.ts';
import { FrameSource } from '../render/frame-source.ts';
import { loadScene, MissingFilesError, SceneRenderer } from '../render/scene-renderer.ts';
import { currentPlayer } from '../clip/playback.ts';
import { projectStore } from '../project/store.ts';
import { notify } from '../ui/prompts.ts';
import { withSpareDecoder } from './spare-decoder.ts';

/** JPG qualities tried in turn, best first, until the picture fits. */
const JPG_QUALITIES = [0.92, 0.85, 0.78, 0.7, 0.6, 0.5];

/** The cover's pixels, RGBA, top row first: OUTPUT.width × OUTPUT.height, from the working `file`, already read in as `media`. */
export async function drawCover(clip: Clip, assets: readonly Asset[], file: WorkingFile, media: Demuxed): Promise<ImageData> {
  const shown = coverClip(clip);
  const time = coverOf(clip).time;
  // A canvas of its own, as for the export: the preview isn't disturbed.
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const frames = new FrameSource(media);
  let compositor: Compositor | undefined;
  let renderer: SceneRenderer | undefined;
  try {
    const scene = await loadScene(shown, assets, [], file.frameRate);
    compositor = new Compositor(canvas);
    renderer = new SceneRenderer(compositor);
    let layerError: unknown;
    renderer.lotties.onError = (_layerId, e) => (layerError ??= e);
    const index = Math.min(Math.max(0, workingFrameIndex(file, time)), frames.frameCount - 1);
    const frame = await frames.seek(index);
    try {
      compositor.upload(frame);
    } finally {
      frame.close();
    }
    await renderer.prepare(scene, time, false);
    if (layerError) throw layerError;
    renderer.draw(scene, time);
    const pixels = compositor.readPixels();
    // Every pixel is opaque: the picture has no see-through parts.
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    return new ImageData(pixels, OUTPUT.width, OUTPUT.height);
  } finally {
    frames.close();
    renderer?.dispose();
    compositor?.dispose();
    compositor?.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/** The picture as a file of `format`: a PNG, or the best JPG quality under MAX_JPG_BYTES. */
export async function encodeCover(image: ImageData, format: CoverFormat): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext('2d')!.putImageData(image, 0, 0);
  if (format === 'png') return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let blob: Blob | undefined;
  for (const quality of JPG_QUALITIES) {
    blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    if (blob.size <= MAX_JPG_BYTES) break;
  }
  if (!blob || blob.size > MAX_JPG_BYTES) throw new Error(`the cover doesn't fit in ${MAX_JPG_BYTES} bytes as a JPG`);
  return new Uint8Array(await blob.arrayBuffer());
}

/** The project's files the cover's layers show. */
export const coverAssets = (clip: Clip, assets: readonly Asset[]): Asset[] => {
  const used = new Set(layerAssetIds({ layers: coverClip(clip).layers }));
  return assets.filter((a) => used.has(a.id));
};

/**
 * Draws the open clip's cover and saves it as `format` where the user
 * says; the clip has to be playing in the editor, for its working file.
 * What went wrong is said in a notice.
 */
export async function saveCover(clip: Clip, format: CoverFormat): Promise<void> {
  const player = currentPlayer();
  if (!player) return;
  try {
    const assets = coverAssets(clip, projectStore.getState().project?.assets ?? []);
    const bytes = await encodeCover(await withSpareDecoder(() => drawCover(clip, assets, player.file, player.media)), format);
    const saved = await window.rezzo.invoke('cover:save', clip.name || i18n.t('clips.untitled'), format, bytes);
    if (saved) notify('info', i18n.t('cover.saved', { file: saved.split(/[\\/]/).pop() }));
  } catch (e) {
    if (e instanceof MissingFilesError) notify('error', i18n.t('cover.missing', { names: e.names.join(', ') }));
    else notify('error', i18n.t('errors.unexpected', { detail: e instanceof Error ? e.message : String(e) }));
  }
}
