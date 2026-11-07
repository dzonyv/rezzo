import { useTranslation } from 'react-i18next';
import { EFFECT_GROUPS, EFFECT_NAMES, EFFECTS, type EffectName } from '../../../shared/effects.ts';
import { addLayerFile } from '../project/assets.ts';
import { addEffectLayer } from '../project/layers.ts';
import { pauseClip } from './playback.ts';
import { selectLayer } from './state.ts';

/** Kinds of file layer the Layers drawer offers. */
const KINDS = ['image', 'video', 'lottie'] as const;

/** The kinds of file that can go over the picture, as tiles; each asks for a file and adds it from the playhead on. */
export function LayerTiles({ clipId, time }: { clipId: string; time: number }) {
  const { t } = useTranslation();
  const add = async (kind: (typeof KINDS)[number]) => {
    pauseClip();
    const id = await addLayerFile(kind, clipId, time);
    if (id) selectLayer(id);
  };
  return (
    <div className="add-tiles" role="group" aria-label={t('layers.addHelp')}>
      {KINDS.map((kind) => (
        <button key={kind} type="button" className="tile" onClick={() => void add(kind)}>
          {t(`layers.kinds.${kind}`)}
        </button>
      ))}
    </div>
  );
}

/** The effects, by group; pressing one adds it from the playhead on. */
export function EffectLibrary({ clipId, time }: { clipId: string; time: number }) {
  const { t } = useTranslation();
  const add = (effect: EffectName) => {
    pauseClip();
    const id = addEffectLayer(clipId, effect, time);
    if (id) selectLayer(id);
  };
  return (
    <div className="effect-library">
      {EFFECT_GROUPS.map((group) => (
        <div key={group} className="effect-group" role="group" aria-label={t(`effects.groups.${group}`)}>
          <h4 className={`effect-group-name ${group}`}>{t(`effects.groups.${group}`)}</h4>
          {EFFECT_NAMES.filter((name) => EFFECTS[name].group === group).map((name) => (
            <button key={name} type="button" onClick={() => add(name)}>
              {t(`effects.names.${name}`)}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
