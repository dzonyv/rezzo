import { useTranslation } from 'react-i18next';
import { EFFECTS, type ParamDef } from '../../../shared/effects.ts';
import { keyAt, valueAt } from '../../../shared/framing.ts';
import type { FrameRate } from '../../../shared/frames.ts';
import type { EffectLayer } from '../../../shared/project.ts';
import { addLayerKey, deleteLayer, deleteLayerKey, duplicateLayer, insideLayer, setEffectParam, setIntensity, setLayerKeySmooth } from '../project/layers.ts';
import { projectStore, type EditLabel } from '../project/store.ts';
import { selectLayer } from './state.ts';

interface Props {
  clipId: string;
  layer: EffectLayer;
  /** Source seconds of the frame on screen; intensity edits and keyframes land there. */
  time: number;
  rate: FrameRate;
}

const INTENSITY: EditLabel = 'history.effectIntensity';
const SETTINGS: EditLabel = 'history.effectSettings';

/** How a setting's value reads: a share as a percentage, others with their unit. */
function shownValue(def: ParamDef, value: number): { unit: ParamDef['unit']; value: string } {
  if (def.unit === 'percent') return { unit: def.unit, value: String(Math.round(value * 100)) };
  return { unit: def.unit, value: def.step >= 1 ? String(Math.round(value)) : value.toFixed(def.step >= 0.1 ? 1 : 2) };
}

/** The selected effect's settings: its intensity with keyframes, and the effect's own settings. */
export function EffectPanel({ clipId, layer, time, rate }: Props) {
  const { t } = useTranslation();
  const store = projectStore.getState();
  const name = t(`effects.names.${layer.effect}`);
  const at = insideLayer(layer, time);
  const keys = layer.intensity;
  const keyIndex = keyAt(keys, at, rate);
  const intensity = valueAt(keys, at);
  const params: [string, ParamDef][] = Object.entries(EFFECTS[layer.effect].params);

  /** One undo step per drag of a slider; arrow keys make a step each. */
  const gesture = (label: EditLabel) => ({
    onPointerDown: () => store.beginGesture(label),
    onPointerUp: () => store.endGesture(),
  });

  const remove = () => {
    deleteLayer(clipId, layer.id);
    selectLayer(null);
  };

  return (
    <section className="layer-panel">
      <header>
        <h3>{t('effects.title', { name })}</h3>
        <button type="button" onClick={() => selectLayer(null)}>
          {t('layers.deselect')}
        </button>
      </header>

      <div className="layer-row">
        <button type="button" onClick={() => selectLayer(duplicateLayer(clipId, layer.id))}>
          {t('layers.duplicate')}
        </button>
        <button type="button" onClick={remove}>
          {t('layers.delete')}
        </button>
      </div>

      <div className="layer-grid">
        <label className="layer-slider">
          <span>{t('effects.intensity')}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={intensity}
            {...gesture(INTENSITY)}
            onChange={(e) => setIntensity(clipId, layer.id, time, Number(e.target.value))}
          />
          <output>{t('effects.units.percent', { value: Math.round(intensity * 100) })}</output>
        </label>
      </div>

      <div className="keyframes">
        <button type="button" disabled={keyIndex >= 0} onClick={() => addLayerKey(clipId, layer.id, time)}>
          <span className="diamond" aria-hidden="true" />
          {t('clipEditor.addKeyframe')}
        </button>
        <label className={keyIndex < 0 || keyIndex === keys.length - 1 ? 'disabled' : undefined}>
          <input
            type="checkbox"
            disabled={keyIndex < 0 || keyIndex === keys.length - 1}
            checked={keyIndex >= 0 && keys[keyIndex]!.ease === 'smooth'}
            onChange={(e) => setLayerKeySmooth(clipId, layer.id, keyIndex, e.target.checked)}
          />
          {t('clipEditor.smooth')}
        </label>
        <button type="button" disabled={keyIndex < 0 || keys.length === 1} onClick={() => deleteLayerKey(clipId, layer.id, keyIndex)}>
          {t('clipEditor.deleteKeyframe')}
        </button>
      </div>

      {params.length > 0 && (
        <div className="layer-grid layer-section">
          {params.map(([param, def]) => {
            const value = layer.params[param] ?? def.value;
            const shown = shownValue(def, value);
            return (
              <label key={param} className="layer-slider">
                <span>{t(`effects.params.${param}` as 'effects.params.amount')}</span>
                <input
                  type="range"
                  min={def.min}
                  max={def.max}
                  step={def.step}
                  value={value}
                  {...gesture(SETTINGS)}
                  onChange={(e) => setEffectParam(clipId, layer.id, param, Number(e.target.value))}
                />
                <output>{param === 'release' && value === 0 ? t('effects.hold') : t(`effects.units.${shown.unit}`, { value: shown.value })}</output>
              </label>
            );
          })}
        </div>
      )}
      <p className="dim hint">{t('effects.help')}</p>
    </section>
  );
}
