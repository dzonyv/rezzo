/**
 * Draws a clip at a moment: works out the scene (shared/scene.ts), paints
 * the captions for that moment and hands both to the compositor. The
 * preview and the export each have one, fed the same Scene, so they draw
 * the same frame for the same time.
 */
import type { Asset, ImageAsset } from '../../../shared/assets.ts';
import { OUTPUT } from '../../../shared/framing.ts';
import type { FrameRate } from '../../../shared/frames.ts';
import { captionLayerOf, timedLayers, type Clip, type Word } from '../../../shared/project.ts';
import { sceneAt } from '../../../shared/scene.ts';
import { CaptionPainter, loadCaptionScene, type CaptionScene } from './captions.ts';
import type { Compositor, LayerImage } from './compositor.ts';
import { loadImage } from './images.ts';
import { LayerFrames } from './layer-frames.ts';
import { requestOverlayFile, type OverlayFile } from './overlay-files.ts';

/** Everything a clip needs drawn, with its fonts and images already loaded. */
export interface Scene {
  clip: Clip;
  assets: readonly Asset[];
  captions: CaptionScene | null;
  /** Pictures by asset id; a layer whose picture is missing isn't drawn. */
  images: ReadonlyMap<string, LayerImage>;
  /** Video layers' working files by layer id; a layer without one isn't drawn. */
  overlays: ReadonlyMap<string, OverlayFile>;
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
  const ids = new Set(timedLayers(clip).map((l) => l.assetId));
  return assets.filter((a) => ids.has(a.id));
}

/**
 * Loads the pictures of the image assets among `assets`. With `strict` (the export) a file that
 * can't be read is an error; otherwise (the preview) it's left out and
 * reported through `onMissing`.
 */
export async function loadImages(assets: readonly Asset[], { strict = false, onMissing }: { strict?: boolean; onMissing?: (asset: Asset) => void } = {}): Promise<Map<string, LayerImage>> {
  const images = new Map<string, LayerImage>();
  const missing: string[] = [];
  await Promise.all(
    assets.filter((a): a is ImageAsset => a.kind === 'image').map(async (asset) => {
      try {
        images.set(asset.id, await loadImage(asset));
      } catch {
        missing.push(asset.name);
        onMissing?.(asset);
      }
    }),
  );
  if (strict && missing.length > 0) throw new MissingFilesError(missing.sort());
  return images;
}

/**
 * The working files of the clip's video layers at `rate`, made now if
 * they aren't in the cache. A layer file that's gone is a MissingFilesError.
 */
export async function loadOverlayFiles(clip: Clip, assets: readonly Asset[], rate: FrameRate): Promise<Map<string, OverlayFile>> {
  const files = new Map<string, OverlayFile>();
  const missing = new Set<string>();
  await Promise.all(
    clip.layers.map(async (layer) => {
      if (layer.kind !== 'overlay') return;
      const asset = assets.find((a) => a.id === layer.assetId);
      if (asset?.kind !== 'video') return;
      const state = await requestOverlayFile(layer, asset, rate);
      if (state.status === 'ready') files.set(layer.id, state.file);
      else if (state.status === 'missing') missing.add(asset.name);
      else if (state.status === 'failed') throw new Error(state.detail);
    }),
  );
  if (missing.size > 0) throw new MissingFilesError([...missing].sort());
  return files;
}

/** Checks that the video files among `assets` are still there; a MissingFilesError names those that aren't. */
export async function checkVideoFiles(assets: readonly Asset[]): Promise<void> {
  const videos = assets.filter((a) => a.kind === 'video');
  const status = await Promise.all(videos.map((a) => window.rezzo.invoke('asset:check', a)));
  const missing = videos.filter((_, i) => status[i] === 'missing').map((a) => a.name);
  if (missing.length > 0) throw new MissingFilesError(missing.sort());
}

/** A Scene for the export: every font, picture and video layer's file loaded, or an error. */
export async function loadScene(clip: Clip, assets: readonly Asset[], words: readonly Word[], rate: FrameRate): Promise<Scene> {
  const [captions, images, overlays] = await Promise.all([
    loadCaptionScene(captionLayerOf(clip), words, clip),
    loadImages(assetsOf(clip, assets), { strict: true }),
    loadOverlayFiles(clip, assets, rate),
  ]);
  return { clip, assets, captions, images, overlays };
}

export class SceneRenderer {
  readonly compositor: Compositor;
  /** Video layers' decoders; their errors come out here. */
  readonly layers: LayerFrames;
  private readonly painter = new CaptionPainter();

  constructor(compositor: Compositor) {
    this.compositor = compositor;
    this.layers = new LayerFrames(compositor);
  }

  /**
   * Decodes what `draw(scene, t)` will need that takes time: the video
   * layers' frames. `sequential` while playing forward. Resolves true when
   * a frame changed, so a paused preview knows to draw again.
   */
  prepare(scene: Scene, t: number, sequential: boolean): Promise<boolean> {
    const ops = sceneAt(scene.clip, scene.assets, t, this.compositor.sourceSize ?? OUTPUT);
    return this.layers.prepare(ops, scene.overlays, sequential);
  }

  dispose(): void {
    this.layers.dispose();
  }

  /** Draws `scene` at source time `t` into the compositor, over the source frame it has. */
  draw(scene: Scene, t: number): void {
    const size = this.compositor.sourceSize;
    if (!size) return;
    const ops = sceneAt(scene.clip, scene.assets, t, size);
    this.compositor.render(ops, scene.images, scene.captions && this.painter.paint(scene.captions, t));
  }
}
