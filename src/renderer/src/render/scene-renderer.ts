/**
 * Draws a clip at a moment: works out the scene (shared/scene.ts), paints
 * the captions for that moment and hands both to the compositor. The
 * preview and the export each have one, fed the same Scene, so they draw
 * the same frame for the same time.
 */
import type { Asset, ImageAsset } from '../../../shared/assets.ts';
import { captionLayerOf, timedLayers, type Clip, type Word } from '../../../shared/project.ts';
import { sceneAt } from '../../../shared/scene.ts';
import { CaptionPainter, loadCaptionScene, type CaptionScene } from './captions.ts';
import type { Compositor, LayerImage } from './compositor.ts';
import { loadImage } from './images.ts';

/** Everything a clip needs drawn, with its fonts and images already loaded. */
export interface Scene {
  clip: Clip;
  assets: readonly Asset[];
  captions: CaptionScene | null;
  /** Pictures by asset id; a layer whose picture is missing isn't drawn. */
  images: ReadonlyMap<string, LayerImage>;
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

/** A Scene for the export: every font and picture loaded, or an error. */
export async function loadScene(clip: Clip, assets: readonly Asset[], words: readonly Word[]): Promise<Scene> {
  const [captions, images] = await Promise.all([
    loadCaptionScene(captionLayerOf(clip), words, clip),
    loadImages(assetsOf(clip, assets), { strict: true }),
  ]);
  return { clip, assets, captions, images };
}

export class SceneRenderer {
  readonly compositor: Compositor;
  private readonly painter = new CaptionPainter();

  constructor(compositor: Compositor) {
    this.compositor = compositor;
  }

  /** Draws `scene` at source time `t` into the compositor, over the source frame it has. */
  draw(scene: Scene, t: number): void {
    const size = this.compositor.sourceSize;
    if (!size) return;
    const ops = sceneAt(scene.clip, scene.assets, t, size);
    this.compositor.render(ops, scene.images, scene.captions && this.painter.paint(scene.captions, t));
  }
}
