import type { TFunction } from 'i18next';
import type { Asset } from '../../../shared/assets.ts';
import { ASSET_KIND_OF, type Clip, type TimedLayer } from '../../../shared/project.ts';

/** What a layer is called on the timeline: its effect, its file, or its kind. */
export function layerName(t: TFunction, layer: TimedLayer, assets: readonly Asset[]): string {
  if (layer.kind === 'effect') return t(`effects.names.${layer.effect}`);
  return assets.find((a) => a.id === layer.assetId)?.name ?? t(`layers.kinds.${ASSET_KIND_OF[layer.kind]}`);
}

/** The timeline's rows above the video, top row first: the layer drawn last. */
export const rowsOf = (clip: Clip): Clip['layers'] => clip.layers.slice(1).reverse();
