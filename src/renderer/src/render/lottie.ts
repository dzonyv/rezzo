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
import type { SceneOp } from '../../../shared/scene.ts';
import type { Compositor } from './compositor.ts';

// The player's WebAssembly comes with the app, never from a CDN.
DotLottie.setWasmUrl(new URL(wasmUrl, document.baseURI).href);

/** An animation as the player takes it: a .lottie package's bytes, or the JSON's text. */
export type LottieData = ArrayBuffer | string;

const cache = new Map<string, Promise<LottieData>>();
const key = (file: AssetFile) => `${file.fingerprint}:${file.path}`;

/**
 * The asset's animation; rejects when the file isn't there any more, even
 * if it was read before, as for images (render/images.ts).
 */
export async function loadLottie(asset: LottieAsset): Promise<LottieData> {
  if ((await window.rezzo.invoke('asset:check', asset)) === 'missing') throw new Error(`${asset.path} is missing`);
  const k = key(asset);
  let loading = cache.get(k);
  if (!loading) {
    loading = window.rezzo.invoke('asset:url', asset).then(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`reading the animation failed: ${response.status}`);
      return asset.path.toLowerCase().endsWith('.lottie') ? response.arrayBuffer() : response.text();
    });
    // A failure isn't kept: the file may be back (or found) next time.
    loading.catch(() => cache.delete(k));
    cache.set(k, loading);
  }
  return loading;
}

/** Lets go of every animation except those of `files` (the open project's assets). */
export function keepOnlyLotties(files: readonly AssetFile[]): void {
  const wanted = new Set(files.map(key));
  for (const k of cache.keys()) if (!wanted.has(k)) cache.delete(k);
}

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
      showing.add(op.layerId);
      const { width, height } = op.size;
      const shown = `${op.frame}|${width}x${height}`;
      if (player.shown === shown) continue;
      if (player.surface.width !== width || player.surface.height !== height) {
        player.surface.width = width;
        player.surface.height = height;
        player.dot.resize();
      }
      player.dot.setFrame(op.frame);
      const pixels = player.dot.buffer;
      if (!pixels || pixels.byteLength !== width * height * 4) continue;
      this.compositor.uploadLayerPixels(op.layerId, pixels, width, height);
      player.shown = shown;
    }
    this.compositor.keepLayerPixels(showing);
    for (const [id, player] of this.players) if (!showing.has(id)) player.shown = '';
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
      dot.addEventListener('load', () => {
        player.loaded = true;
        resolve();
      });
      dot.addEventListener('loadError', ({ error }) => reject(error));
    });
    player.ready.catch((e: unknown) => {
      if (this.players.get(layerId) === player) this.onError?.(layerId, e);
    });
    this.players.set(layerId, player);
    return player;
  }
}
