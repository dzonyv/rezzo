import type { TFunction } from 'i18next';
import type { Asset } from '../../../shared/assets.ts';
import { ASSET_KIND_OF, isSound, type Clip, type TimedLayer } from '../../../shared/project.ts';
import { textName } from '../../../shared/text-style.ts';

/** What a layer is called on the timeline: its effect, its sound (and which part of a layer's animation it goes with), its text, its file, or its kind. */
export function layerName(t: TFunction, layer: TimedLayer, assets: readonly Asset[]): string {
  if (layer.kind === 'effect') return t(`effects.names.${layer.effect}`);
  if (layer.kind === 'sound') {
    const { sound, follows } = layer;
    const name = 'library' in sound ? t(`sounds.names.${sound.library}`) : (assets.find((a) => a.id === sound.assetId)?.name ?? t('layers.kinds.audio'));
    if (!follows) return name;
    return follows.part === 'in' ? t('sounds.follow.tagIn', { name }) : t('sounds.follow.tagOut', { name });
  }
  if (layer.kind === 'text') return textName(layer.text) || t('layers.kinds.text');
  return assets.find((a) => a.id === layer.assetId)?.name ?? t(`layers.kinds.${ASSET_KIND_OF[layer.kind]}`);
}

/** The timeline's rows above the video, top row first: the layer drawn last. Sounds draw nothing and have rows of their own. */
export const rowsOf = (clip: Clip): Clip['layers'] => clip.layers.slice(1).filter((l) => !isSound(l)).reverse();
