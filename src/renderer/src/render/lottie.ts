/**
 * Lottie layers: the animations' files, read once per file and shared by
 * the preview and the export, and a player per layer that renders the
 * frame the scene asks for into the compositor.
 *
 * The players are dotlottie-web's (ThorVG compiled to WebAssembly). Each
 * renders into its own pixel buffer rather than a canvas: setFrame()
 * renders that exact frame at once, the buffer goes straight into a
 * texture, and nothing plays on its own clock.
 */
import { DotLottie } from '@lottiefiles/dotlottie-web';
import wasmUrl from '@lottiefiles/dotlottie-web/dotlottie-player.wasm?url';
import type { AssetFile, LottieAsset } from '../../../shared/assets.ts';
import type { Size } from '../../../shared/framing.ts';
import { isZip } from '../../../shared/lottie.ts';
import type { SceneOp } from '../../../shared/scene.ts';
import type { Compositor } from './compositor.ts';
import { FileCache } from './file-cache.ts';

// The player's WebAssembly comes with the app, never from a CDN.
DotLottie.setWasmUrl(new URL(wasmUrl, document.baseURI).href);

/** An animation that hasn't loaded after this long counts as failed. */
const LOAD_TIMEOUT_MS = 20_000;

/** An animation as the player takes it: a .lottie package's bytes, or the JSON's text. */
export type LottieData = ArrayBuffer | string;

/** Reads an animation: a zip (whatever the file is called) is a .lottie package, anything else JSON. */
async function readLottie(url: string): Promise<LottieData> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`reading the animation failed: ${response.status}`);
  const bytes = await response.arrayBuffer();
  return isZip(new Uint8Array(bytes)) ? bytes : new TextDecoder().decode(bytes);
}

const animations = new FileCache<LottieData>(readLottie);

/** The asset's animation; rejects when the file isn't there any more (see FileCache.load). */
export const loadLottie = (asset: LottieAsset): Promise<LottieData> => animations.load(asset);

/** Lets go of every animation except those of `files` (the open project's assets). */
export const keepOnlyLotties = (files: readonly AssetFile[]): void => animations.keepOnly(files);

interface Player {
  assetId: string;
  dot: DotLottie;
  /** What the player renders into; its size is changed in place. */
  surface: Size;
  /** Resolves once the animation is loaded; rejects if it can't be. */
  ready: Promise<void>;
  loaded: boolean;
  /** The frame and size in the compositor now, so an unchanged frame isn't uploaded again. */
  shown: string;
}

/** Players for a scene's Lottie layers, by layer id. */
export class LottieLayers {
  /** A layer's animation couldn't be loaded; it's left out of the picture. */
  onError: ((layerId: string, error: unknown) => void) | undefined;

  private readonly compositor: Compositor;
  private readonly players = new Map<string, Player>();

  constructor(compositor: Compositor) {
    this.compositor = compositor;
  }

  /**
   * Makes sure the Lottie layers among `ops` have a loaded player, from the
   * animations in `data` (by asset id). Players of layers not in `keep`
   * (the clip's layers) go. Resolves true when one became ready.
   */
  async prepare(ops: readonly SceneOp[], data: ReadonlyMap<string, LottieData>, keep: ReadonlySet<string>): Promise<boolean> {
    for (const [id, player] of this.players) {
      if (keep.has(id)) continue;
      player.dot.destroy();
      this.players.delete(id);
    }
    const waiting: Promise<boolean>[] = [];
    for (const op of ops) {
      if (op.type !== 'lottie') continue;
      let player = this.players.get(op.layerId);
      if (player && player.assetId !== op.assetId) {
        player.dot.destroy();
        this.players.delete(op.layerId);
        player = undefined;
      }
      if (!player) {
        const animation = data.get(op.assetId);
        if (animation === undefined) continue;
        player = this.load(op.layerId, op.assetId, animation, op.size);
      }
      if (!player.loaded) {
        const p = player;
        waiting.push(p.ready.then(() => true, () => false));
      }
    }
    return (await Promise.all(waiting)).some(Boolean);
  }

  /** Renders the Lottie layers among `ops` at their frame and size into the compositor. */
  draw(ops: readonly SceneOp[]): void {
    const showing = new Set<string>();
    for (const op of ops) {
      if (op.type !== 'lottie') continue;
      const player = this.players.get(op.layerId);
      if (!player?.loaded) continue;
      const shown = `${op.frame}|${op.size.width}x${op.size.height}`;
      // A frame that didn't render leaves the layer out, rather than an older frame stretched to this size.
      if (player.shown !== shown && !this.render(op.layerId, player, op.frame, op.size)) continue;
      player.shown = shown;
      showing.add(op.layerId);
    }
    this.compositor.keepLayerPixels(showing);
    for (const [id, player] of this.players) if (!showing.has(id)) player.shown = '';
  }

  /** Renders the player's frame at `size` into the compositor; false if it came out at another size. */
  private render(layerId: string, player: Player, frame: number, { width, height }: Size): boolean {
    if (player.surface.width !== width || player.surface.height !== height) {
      player.surface.width = width;
      player.surface.height = height;
      player.dot.resize();
    }
    player.dot.setFrame(frame);
    const pixels = player.dot.buffer;
    if (!pixels || pixels.byteLength !== width * height * 4) return false;
    this.compositor.uploadLayerPixels(layerId, pixels, width, height);
    return true;
  }

  dispose(): void {
    for (const player of this.players.values()) player.dot.destroy();
    this.players.clear();
  }

  private load(layerId: string, assetId: string, data: LottieData, size: Size): Player {
    const surface = { ...size };
    const dot = new DotLottie({
      canvas: surface,
      data,
      autoplay: false,
      loop: false,
      // Fractional frames: the clip's frame rate rarely matches the animation's.
      useFrameInterpolation: true,
      renderConfig: { autoResize: false, freezeOnOffscreen: false, devicePixelRatio: 1 },
    });
    const player: Player = { assetId, dot, surface, ready: Promise.resolve(), loaded: false, shown: '' };
    player.ready = new Promise<void>((resolve, reject) => {
      // The preview and the export wait for this; one that never settles would stop them for good.
      const timer = setTimeout(() => reject(new Error('the animation took too long to load')), LOAD_TIMEOUT_MS);
      dot.addEventListener('load', () => {
        clearTimeout(timer);
        player.loaded = true;
        resolve();
      });
      dot.addEventListener('loadError', ({ error }) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    player.ready.catch((e: unknown) => {
      if (this.players.get(layerId) === player) this.onError?.(layerId, e);
    });
    this.players.set(layerId, player);
    return player;
  }
}
