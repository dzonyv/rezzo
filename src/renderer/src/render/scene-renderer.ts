/**
 * Draws a clip at a moment: works out the scene (shared/scene.ts), paints
 * the captions and renders the animations for that moment and hands them
 * to the compositor. The
 * preview and the export each have one, fed the same Scene, so they draw
 * the same frame for the same time.
 */
import type { Asset, ImageAsset, LottieAsset } from '../../../shared/assets.ts';
import { OUTPUT } from '../../../shared/framing.ts';
import type { FrameRate } from '../../../shared/frames.ts';
import { captionLayerOf, fileLayers, videoLayerOf, type Clip, type Word } from '../../../shared/project.ts';
import { videoLayersOf } from '../../../shared/overlay-files.ts';
import { sceneAt } from '../../../shared/scene.ts';
import { CaptionPainter, loadCaptionScene, type CaptionScene } from './captions.ts';
import type { Compositor, LayerImage } from './compositor.ts';
import { loadImage } from './images.ts';
import { LayerFrames } from './layer-frames.ts';
import { loadLottie, LottieLayers, type LottieData } from './lottie.ts';
import { requestOverlayFile, type OverlayFile } from './overlay-files.ts';
import { loadTexts, type TextImage } from './text.ts';

/** Everything a clip needs drawn, with its fonts and images already loaded. */
export interface Scene {
  clip: Clip;
  assets: readonly Asset[];
  captions: CaptionScene | null;
  /** Pictures by asset id; a layer whose picture is missing isn't drawn. */
  images: ReadonlyMap<string, LayerImage>;
  /** Video layers' working files by layer id; a layer without one isn't drawn. */
  overlays: ReadonlyMap<string, OverlayFile>;
  /** Animations by asset id; a layer whose animation is missing isn't drawn. */
  lotties: ReadonlyMap<string, LottieData>;
  /** Text layers' pictures by layer id (render/text.ts); one that isn't there isn't drawn. */
  texts: ReadonlyMap<string, TextImage>;
}

/** Files a clip's layers show that couldn't be read. */
export class MissingFilesError extends Error {
  readonly names: string[];

  constructor(names: string[]) {
    super(`missing files: ${names.join(', ')}`);
    this.names = names;
  }
}

/** The assets the clip's layers use. */
export function assetsOf(clip: Clip, assets: readonly Asset[]): Asset[] {
  const ids = new Set(fileLayers(clip).map((l) => l.assetId));
  return assets.filter((a) => ids.has(a.id));
}

interface LoadOptions {
  /** A file that can't be read is an error (the export), rather than left out and reported through `onMissing` (the preview). */
  strict?: boolean;
  onMissing?: (asset: Asset) => void;
}

/** Reads the assets of one kind among `assets` with `load`, by asset id. */
async function loadFiles<A extends Asset, T>(assets: readonly A[], load: (asset: A) => Promise<T>, { strict = false, onMissing }: LoadOptions): Promise<Map<string, T>> {
  const loaded = new Map<string, T>();
  const missing: string[] = [];
  await Promise.all(
    assets.map(async (asset) => {
      try {
        loaded.set(asset.id, await load(asset));
      } catch {
        missing.push(asset.name);
        onMissing?.(asset);
      }
    }),
  );
  if (strict && missing.length > 0) throw new MissingFilesError(missing.sort());
  return loaded;
}

/** Loads the pictures of the image assets among `assets` (see LoadOptions). */
export const loadImages = (assets: readonly Asset[], options: LoadOptions = {}): Promise<Map<string, LayerImage>> =>
  loadFiles(assets.filter((a): a is ImageAsset => a.kind === 'image'), loadImage, options);

/** Reads the animations among `assets` (see LoadOptions). */
export const loadLotties = (assets: readonly Asset[], options: LoadOptions = {}): Promise<Map<string, LottieData>> =>
  loadFiles(assets.filter((a): a is LottieAsset => a.kind === 'lottie'), loadLottie, options);

/**
 * The working files of the clip's video layers at `rate`, made now if
 * they aren't in the cache. A layer file that's gone is a MissingFilesError.
 * Aborting `signal` stops the conversions nobody else waits for and rejects.
 */
export async function loadOverlayFiles(clip: Clip, assets: readonly Asset[], rate: FrameRate, signal?: AbortSignal): Promise<Map<string, OverlayFile>> {
  const files = new Map<string, OverlayFile>();
  const missing = new Set<string>();
  const asked: string[] = [];
  const stop = () => asked.forEach((requestId) => void window.rezzo.invoke('overlay:cancel', requestId));
  signal?.addEventListener('abort', stop, { once: true });
  try {
    await Promise.all(
      videoLayersOf(clip, assets).map(async ({ layer, asset }) => {
        if (signal?.aborted) return;
        const requestId = crypto.randomUUID();
        asked.push(requestId);
        const state = await requestOverlayFile(layer, asset, rate, requestId);
        if (state?.status === 'ready') files.set(layer.id, state.file);
        else if (state?.status === 'missing') missing.add(asset.name);
        else if (state?.status === 'failed') throw new Error(state.detail);
      }),
    );
  } finally {
    signal?.removeEventListener('abort', stop);
  }
  signal?.throwIfAborted();
  if (missing.size > 0) throw new MissingFilesError([...missing].sort());
  return files;
}

/** Checks that the video and sound files among `assets` are still there (FFmpeg reads them); a MissingFilesError names those that aren't. */
export async function checkMediaFiles(assets: readonly Asset[]): Promise<void> {
  const videos = assets.filter((a) => a.kind === 'video' || a.kind === 'audio');
  const status = await Promise.all(videos.map((a) => window.rezzo.invoke('asset:check', a)));
  const missing = videos.filter((_, i) => status[i] === 'missing').map((a) => a.name);
  if (missing.length > 0) throw new MissingFilesError(missing.sort());
}

/** A Scene for the export: every font, picture, animation, text and video layer's file loaded, or an error. `signal` stops the wait for the video layers' files. */
export async function loadScene(clip: Clip, assets: readonly Asset[], words: readonly Word[], rate: FrameRate, signal?: AbortSignal): Promise<Scene> {
  const [captions, images, lotties, overlays, texts] = await Promise.all([
    loadCaptionScene(captionLayerOf(clip), words, clip),
    loadImages(assetsOf(clip, assets), { strict: true }),
    loadLotties(assetsOf(clip, assets), { strict: true }),
    loadOverlayFiles(clip, assets, rate, signal),
    loadTexts(clip),
  ]);
  return { clip, assets, captions, images, overlays, lotties, texts };
}

export class SceneRenderer {
  readonly compositor: Compositor;
  /** Video layers' decoders; their errors come out here. */
  readonly layers: LayerFrames;
  /** Lottie layers' players; their errors come out here. */
  readonly lotties: LottieLayers;
  private readonly painter = new CaptionPainter();

  constructor(compositor: Compositor) {
    this.compositor = compositor;
    this.layers = new LayerFrames(compositor);
    this.lotties = new LottieLayers(compositor);
  }

  /**
   * Gets what `draw(scene, t)` will need that takes time: the video
   * layers' frames decoded, the animations loaded. `sequential` while
   * playing forward. Resolves true when something changed, so a paused
   * preview knows to draw again.
   */
  async prepare(scene: Scene, t: number, sequential: boolean): Promise<boolean> {
    const ops = sceneAt(scene.clip, scene.assets, t, this.compositor.sourceSize ?? OUTPUT, scene.texts);
    const keep = new Set(scene.clip.layers.map((l) => l.id));
    const changed = await Promise.all([this.layers.prepare(ops, scene.overlays, sequential), this.lotties.prepare(ops, scene.lotties, keep)]);
    return changed.some(Boolean);
  }

  dispose(): void {
    this.layers.dispose();
    this.lotties.dispose();
  }

  /** Draws `scene` at source time `t` into the compositor, over the source frame it has. */
  draw(scene: Scene, t: number): void {
    const size = this.compositor.sourceSize;
    if (!size) return;
    const ops = sceneAt(scene.clip, scene.assets, t, size, scene.texts);
    this.lotties.draw(ops);
    this.compositor.render(ops, scene.images, scene.captions && this.painter.paint(scene.captions, videoLayerOf(scene.clip).layout, t), scene.texts);
  }
}
