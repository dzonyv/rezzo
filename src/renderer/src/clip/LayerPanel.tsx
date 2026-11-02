import { useTranslation } from 'react-i18next';
import type { Asset } from '../../../shared/assets.ts';
import { keyAt, valueAt } from '../../../shared/framing.ts';
import type { FrameRate } from '../../../shared/frames.ts';
import {
  DIRECTIONS, ENTRANCES, EXITS, LOOPS, MAX_LAYER_SCALE, MAX_MOTION_SECONDS, MIN_LAYER_SCALE, MIN_MOTION_SECONDS, type Direction, type Motion,
  type Transform,
} from '../../../shared/motion.ts';
import type { TimedLayer } from '../../../shared/project.ts';
import { changeImage, locateAsset, useAssetMissing } from '../project/assets.ts';
import { addLayerKey, deleteLayer, deleteLayerKey, duplicateLayer, setLayerKeySmooth, setMotion, setTransform } from '../project/layers.ts';
import { projectStore, type EditLabel } from '../project/store.ts';
import { selectLayer } from './state.ts';

interface Props {
  clipId: string;
  layer: TimedLayer;
  asset: Asset | undefined;
  /** Source seconds of the frame on screen; placement edits and keyframes land there. */
  time: number;
  rate: FrameRate;
}

const PLACE: EditLabel = 'history.placeLayer';
const ANIMATE: EditLabel = 'history.layerAnimation';

/** The placement sliders: which value, its range and step, and how it's shown. */
const PLACEMENT: { key: keyof Transform; min: number; max: number; step: number; show: (v: number) => string }[] = [
  { key: 'x', min: 0, max: 1, step: 0.001, show: (v) => `${Math.round(v * 100)}%` },
  { key: 'y', min: 0, max: 1, step: 0.001, show: (v) => `${Math.round(v * 100)}%` },
  { key: 'scale', min: MIN_LAYER_SCALE, max: Math.min(MAX_LAYER_SCALE, 3), step: 0.01, show: (v) => `${Math.round(v * 100)}%` },
  { key: 'rotation', min: -180, max: 180, step: 1, show: (v) => `${Math.round(v)}°` },
  { key: 'opacity', min: 0, max: 1, step: 0.01, show: (v) => `${Math.round(v * 100)}%` },
];

/** The three animation settings, each with the kinds it offers and where a direction applies. */
const PARTS = [
  { part: 'in', kinds: ENTRANCES, names: 'entrances', directed: 'slide' },
  { part: 'out', kinds: EXITS, names: 'exits', directed: 'slide' },
  { part: 'loop', kinds: LOOPS, names: 'loops', directed: 'kenBurns' },
] as const;

/** The selected image's settings: its file, placement, keyframes and animations. */
export function LayerPanel({ clipId, layer, asset, time, rate }: Props) {
  const { t } = useTranslation();
  const missing = useAssetMissing(asset?.id);
  const store = projectStore.getState();
  const name = asset?.name ?? t('layers.kinds.image');
  const value = valueAt(layer.transform, time);
  const keys = layer.transform;
  const keyIndex = keyAt(keys, time, rate);

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

  /** The kind picker for one part of the animation, with its direction, length or strength when they apply. */
  const animation = ({ part, kinds, names, directed }: (typeof PARTS)[number]) => {
    const m = layer.motion[part];
    const set = (patch: Partial<Motion[typeof part]>) => setMotion(clipId, layer.id, part, patch);
    return (
      <div key={part} className="layer-animation">
        <label>
          <span>{t(`layers.${part}`)}</span>
          <select value={m.kind} onChange={(e) => set({ kind: e.target.value as Motion[typeof part]['kind'] })}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {t(`layers.${names}.${k}` as 'layers.loops.none')}
              </option>
            ))}
          </select>
        </label>
        {m.kind === directed && (
          <label>
            <span>{t('layers.direction')}</span>
            <select value={m.direction} onChange={(e) => set({ direction: e.target.value as Direction })}>
              {DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {t(`layers.directions.${d}`)}
                </option>
              ))}
            </select>
          </label>
        )}
        {m.kind !== 'none' && 'seconds' in m &&
          slider(t('layers.seconds'), m.seconds, { min: MIN_MOTION_SECONDS, max: MAX_MOTION_SECONDS, step: 0.05 }, `${m.seconds.toFixed(2)} s`, ANIMATE, (seconds) => set({ seconds }))}
        {m.kind !== 'none' && 'strength' in m &&
          slider(t('layers.strength'), m.strength, { min: 0, max: 1, step: 0.01 }, `${Math.round(m.strength * 100)}%`, ANIMATE, (strength) => set({ strength }))}
      </div>
    );
  };

  return (
    <section className="layer-panel">
      <header>
        <h3>{t('layers.title', { name })}</h3>
        <button type="button" onClick={() => selectLayer(null)}>
          {t('layers.deselect')}
        </button>
      </header>

      {missing && asset && (
        <div className="layer-warning">
          <span>{t('layers.missing', { name: asset.name, path: asset.path })}</span>
          <button type="button" onClick={() => void locateAsset(asset)}>
            {t('layers.locate')}
          </button>
        </div>
      )}

      <div className="layer-row">
        <button type="button" onClick={() => void changeImage(clipId, layer.id)}>
          {t('layers.change')}
        </button>
        <button type="button" onClick={() => selectLayer(duplicateLayer(clipId, layer.id))}>
          {t('layers.duplicate')}
        </button>
        <button type="button" onClick={remove}>
          {t('layers.delete')}
        </button>
      </div>

      <div className="layer-grid">
        {PLACEMENT.map((p) => (
          <div key={p.key}>{slider(t(`layers.${p.key}`), value[p.key], p, p.show(value[p.key]), PLACE, (v) => setTransform(clipId, layer.id, time, { [p.key]: v }))}</div>
        ))}
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
      <p className="dim hint">{t('layers.placeHelp')}</p>
      <p className="dim hint">{t('layers.keyframeHelp')}</p>

      <div className="layer-grid">{PARTS.map(animation)}</div>
    </section>
  );
}
