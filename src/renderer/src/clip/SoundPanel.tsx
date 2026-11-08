import { useTranslation } from 'react-i18next';
import type { Asset } from '../../../shared/assets.ts';
import type { SoundLayer } from '../../../shared/project.ts';
import { soundAsset, soundDuration } from '../../../shared/sound-mix.ts';
import { MAX_FADE_SECONDS } from '../../../shared/sounds.ts';
import { changeLayerFile, locateAsset, useAssetMissing } from '../project/assets.ts';
import { deleteLayer, duplicateLayer, setSoundSettings, setSoundStart } from '../project/layers.ts';
import { projectStore, type EditLabel } from '../project/store.ts';
import { layerName } from './layer-names.ts';
import { selectLayer } from './state.ts';

const SOUND: EditLabel = 'history.soundSettings';
const START: EditLabel = 'history.soundStart';

/** The selected sound's settings: its file, volume, fades, where in the file it starts and whether it loops. */
export function SoundPanel({ clipId, layer, assets }: { clipId: string; layer: SoundLayer; assets: readonly Asset[] }) {
  const { t } = useTranslation();
  const store = projectStore.getState();
  const asset = soundAsset(layer, assets);
  const missing = useAssetMissing(asset?.id);
  const name = layerName(t, layer, assets);
  const duration = soundDuration(layer, assets) ?? 0;
  // A fade can be set as long as the layer; it's only ever half of what plays (shared/sound-mix.ts).
  const longestFade = Math.max(0.1, Math.min(MAX_FADE_SECONDS, Math.ceil((layer.end - layer.start) * 10) / 10));
  const seconds = (v: number) => t('layers.units.seconds', { value: v.toFixed(1) });

  /** One undo step per drag of a slider; arrow keys make a step each. */
  const gesture = (label: EditLabel) => ({ onPointerDown: () => store.beginGesture(label), onPointerUp: () => store.endGesture() });

  const slider = (label: string, v: number, range: { min: number; max: number; step: number }, shown: string, undo: EditLabel, onChange: (v: number) => void) => (
    <label className="layer-slider">
      <span>{label}</span>
      <input type="range" min={range.min} max={range.max} step={range.step} value={v} {...gesture(undo)} onChange={(e) => onChange(Number(e.target.value))} />
      <output>{shown}</output>
    </label>
  );

  const remove = () => {
    deleteLayer(clipId, layer.id);
    selectLayer(null);
  };

  return (
    <section className="layer-panel">
      <header>
        <h3>{t('sounds.title', { name })}</h3>
        <button type="button" onClick={() => selectLayer(null)}>
          {t('layers.deselect')}
        </button>
      </header>

      {missing && asset && (
        <div className="layer-warning">
          <span>{t('sounds.missing', { name: asset.name, path: asset.path })}</span>
          <button type="button" onClick={() => void locateAsset(asset)}>
            {t('layers.locate')}
          </button>
        </div>
      )}

      <div className="layer-row">
        {asset && (
          <button type="button" onClick={() => void changeLayerFile(clipId, layer.id, 'audio')}>
            {t('sounds.change')}
          </button>
        )}
        <button type="button" onClick={() => selectLayer(duplicateLayer(clipId, layer.id))}>
          {t('layers.duplicate')}
        </button>
        <button type="button" onClick={remove}>
          {t('layers.delete')}
        </button>
      </div>

      <div className="layer-grid">
        {slider(t('layers.volume'), layer.volume, { min: 0, max: 1, step: 0.01 }, t('layers.units.percent', { value: Math.round(layer.volume * 100) }), SOUND, (volume) =>
          setSoundSettings(clipId, layer.id, { volume }),
        )}
        {slider(t('sounds.fadeIn'), Math.min(layer.fadeIn, longestFade), { min: 0, max: longestFade, step: 0.1 }, seconds(layer.fadeIn), SOUND, (fadeIn) =>
          setSoundSettings(clipId, layer.id, { fadeIn }),
        )}
        {slider(t('sounds.fadeOut'), Math.min(layer.fadeOut, longestFade), { min: 0, max: longestFade, step: 0.1 }, seconds(layer.fadeOut), SOUND, (fadeOut) =>
          setSoundSettings(clipId, layer.id, { fadeOut }),
        )}
        {asset &&
          duration > 1 &&
          slider(t('sounds.start'), layer.offset, { min: 0, max: Math.max(0, duration - 0.1), step: 0.1 }, seconds(layer.offset), START, (offset) =>
            setSoundStart(clipId, layer.id, offset, duration),
          )}
      </div>
      <label className="layer-check">
        <input type="checkbox" checked={layer.loop} onChange={(e) => setSoundSettings(clipId, layer.id, { loop: e.target.checked })} />
        {t('sounds.loop')}
      </label>
      <p className="dim hint">{t('sounds.help')}</p>
    </section>
  );
}
