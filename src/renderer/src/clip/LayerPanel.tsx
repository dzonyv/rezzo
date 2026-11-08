import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Asset } from '../../../shared/assets.ts';
import { keyAt, valueAt } from '../../../shared/framing.ts';
import { fps, type FrameRate } from '../../../shared/frames.ts';
import {
  DIRECTIONS, ENTRANCES, EXITS, LOOPS, MAX_LAYER_SCALE, MAX_MOTION_SECONDS, MIN_LAYER_SCALE, MIN_MOTION_SECONDS, type Direction, type Motion,
  type Transform,
} from '../../../shared/motion.ts';
import { MAX_VIDEO_LAYERS } from '../../../shared/overlay-files.ts';
import { ASSET_KIND_OF, MAX_LOTTIE_SPEED, MIN_LOTTIE_SPEED, type PlacedLayer } from '../../../shared/project.ts';
import { changeLayerFile, locateAsset, useAssetMissing } from '../project/assets.ts';
import {
  addLayerKey, deleteLayer, deleteLayerKey, duplicateLayer, insideLayer, setChromaKey, setLayerKeySmooth, setLayerSound, setLottiePlayback, setMotion,
  setTransform, setVideoStart,
} from '../project/layers.ts';
import { projectStore, type EditLabel } from '../project/store.ts';
import { startPicking, stopPicking, usePicking } from './eyedropper.ts';
import { selectLayer } from './state.ts';

interface Props {
  clipId: string;
  layer: PlacedLayer;
  asset: Asset | undefined;
  /** Source seconds of the frame on screen; placement edits and keyframes land there. */
  time: number;
  rate: FrameRate;
  /** A video layer that's left out somewhere because too many others show then. */
  overLimit: boolean;
}

const PLACE: EditLabel = 'history.placeLayer';
const ANIMATE: EditLabel = 'history.layerAnimation';
const KEY: EditLabel = 'history.greenScreen';
const SOUND: EditLabel = 'history.layerSound';
const VIDEO_START: EditLabel = 'history.videoStart';
const PLAYBACK: EditLabel = 'history.lottiePlayback';

/** Per kind of file: the panel's title and the button that picks another file. */
const TEXTS = {
  image: { title: 'layers.title', change: 'layers.change' },
  video: { title: 'layers.titleVideo', change: 'layers.changeVideo' },
  lottie: { title: 'layers.titleLottie', change: 'layers.changeLottie' },
} as const;

/**
 * The placement sliders: which value, its usual range and step, and its
 * unit. A value dragged past the usual range (a layer partly off screen)
 * widens the slider rather than being pulled back by it.
 */
const PLACEMENT: { key: keyof Transform; min: number; max: number; step: number; unit: 'percent' | 'degrees' }[] = [
  { key: 'x', min: 0, max: 1, step: 0.001, unit: 'percent' },
  { key: 'y', min: 0, max: 1, step: 0.001, unit: 'percent' },
  { key: 'scale', min: MIN_LAYER_SCALE, max: Math.min(MAX_LAYER_SCALE, 3), step: 0.01, unit: 'percent' },
  { key: 'rotation', min: -180, max: 180, step: 1, unit: 'degrees' },
  { key: 'opacity', min: 0, max: 1, step: 0.01, unit: 'percent' },
];

/** The three animation settings, each with the kinds it offers and where a direction applies. */
const PARTS = [
  { part: 'in', kinds: ENTRANCES, names: 'entrances', directed: 'slide' },
  { part: 'out', kinds: EXITS, names: 'exits', directed: 'slide' },
  { part: 'loop', kinds: LOOPS, names: 'loops', directed: 'kenBurns' },
] as const;

/** The selected layer's settings: its file, placement, keyframes, animations, a video's sound, an animation's playback and the green screen. */
export function LayerPanel({ clipId, layer, asset, time, rate, overLimit }: Props) {
  const { t } = useTranslation();
  const missing = useAssetMissing(asset?.id);
  const picking = usePicking() === layer.id;
  useEffect(() => stopPicking, []);
  const store = projectStore.getState();
  const kind = ASSET_KIND_OF[layer.kind];
  const name = asset?.name ?? t(`layers.kinds.${kind}`);
  // Edits land inside the layer's time even with the playhead outside it (see insideLayer).
  const at = insideLayer(layer, time);
  const value = valueAt(layer.transform, at);
  const keys = layer.transform;
  const keyIndex = keyAt(keys, at, rate);

  const percent = (v: number) => t('layers.units.percent', { value: Math.round(v * 100) });
  const shown = (v: number, unit: 'percent' | 'degrees') => (unit === 'percent' ? percent(v) : t('layers.units.degrees', { value: Math.round(v) }));

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
          slider(t('layers.seconds'), m.seconds, { min: MIN_MOTION_SECONDS, max: MAX_MOTION_SECONDS, step: 0.05 }, t('layers.units.seconds', { value: m.seconds.toFixed(2) }), ANIMATE, (seconds) => set({ seconds }))}
        {m.kind !== 'none' && 'strength' in m &&
          slider(t('layers.strength'), m.strength, { min: 0, max: 1, step: 0.01 }, percent(m.strength), ANIMATE, (strength) => set({ strength }))}
      </div>
    );
  };

  /** A video layer's sound and where in its file it starts. */
  const video = () => {
    if (layer.kind !== 'overlay' || asset?.kind !== 'video') return null;
    const frame = 1 / fps(rate);
    return (
      <div className="layer-grid layer-section">
        <h4>{t('layers.sound')}</h4>
        {asset.hasAudio
          ? slider(t('layers.volume'), layer.volume, { min: 0, max: 1, step: 0.01 }, percent(layer.volume), SOUND, (volume) => setLayerSound(clipId, layer.id, { volume }))
          : <p className="dim hint">{t('layers.noSound')}</p>}
        {slider(
          t('layers.videoStart'),
          layer.offset,
          { min: 0, max: Math.max(frame, asset.duration - frame), step: frame },
          t('layers.units.seconds', { value: layer.offset.toFixed(2) }),
          VIDEO_START,
          (offset) => setVideoStart(clipId, layer.id, offset, asset.duration),
        )}
        <label className="layer-check">
          <input type="checkbox" checked={layer.loop} onChange={(e) => setLayerSound(clipId, layer.id, { loop: e.target.checked })} />
          {t('layers.loopVideo')}
        </label>
        <p className="dim hint">{t('layers.videoHelp')}</p>
      </div>
    );
  };

  /** How fast an animation plays and whether it starts over. */
  const lottie = () => {
    if (layer.kind !== 'lottie') return null;
    return (
      <div className="layer-grid layer-section">
        <h4>{t('layers.playback')}</h4>
        {slider(
          t('layers.speed'),
          layer.speed,
          { min: MIN_LOTTIE_SPEED, max: MAX_LOTTIE_SPEED, step: 0.05 },
          t('layers.units.times', { value: layer.speed.toFixed(2) }),
          PLAYBACK,
          (speed) => setLottiePlayback(clipId, layer.id, { speed }),
        )}
        <label className="layer-check">
          <input type="checkbox" checked={layer.loop} onChange={(e) => setLottiePlayback(clipId, layer.id, { loop: e.target.checked })} />
          {t('layers.loopLottie')}
        </label>
        <p className="dim hint">{t('layers.lottieHelp')}</p>
      </div>
    );
  };

  /** The green screen: on or off, its colour (typed, chosen or picked from the picture) and how it keys. */
  const greenScreen = () => {
    if (layer.kind === 'lottie') return null;
    const key = layer.key;
    return (
      <div className="layer-grid layer-section">
        <label className="layer-check">
          <input type="checkbox" checked={key !== null} onChange={(e) => setChromaKey(clipId, layer.id, e.target.checked ? {} : null)} />
          {t('layers.greenScreen')}
        </label>
        {key && (
          <>
            <div className="layer-row">
              <label className="layer-color">
                <span>{t('layers.keyColor')}</span>
                <input
                  type="color"
                  value={key.color}
                  onFocus={() => store.beginGesture(KEY)}
                  onBlur={() => store.endGesture()}
                  onChange={(e) => setChromaKey(clipId, layer.id, { color: e.target.value })}
                />
              </label>
              <button type="button" aria-pressed={picking} onClick={() => (picking ? stopPicking() : startPicking(layer.id))}>
                {t('layers.pickColor')}
              </button>
            </div>
            {picking && <p className="hint">{t('layers.picking')}</p>}
            {slider(t('layers.similarity'), key.similarity, { min: 0, max: 1, step: 0.01 }, percent(key.similarity), KEY, (similarity) => setChromaKey(clipId, layer.id, { similarity }))}
            {slider(t('layers.smoothness'), key.smoothness, { min: 0, max: 1, step: 0.01 }, percent(key.smoothness), KEY, (smoothness) => setChromaKey(clipId, layer.id, { smoothness }))}
            {slider(t('layers.spill'), key.spill, { min: 0, max: 1, step: 0.01 }, percent(key.spill), KEY, (spill) => setChromaKey(clipId, layer.id, { spill }))}
          </>
        )}
      </div>
    );
  };

  return (
    <section className="layer-panel">
      <header>
        <h3>{t(TEXTS[kind].title, { name })}</h3>
        <button type="button" title={t('layers.back.help')} onClick={() => selectLayer(null)}>
          {t('layers.back.layers')}
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

      {overLimit && (
        <div className="layer-warning">
          <span>{t('layers.overLimit', { count: MAX_VIDEO_LAYERS })}</span>
        </div>
      )}

      <div className="layer-row">
        <button type="button" onClick={() => void changeLayerFile(clipId, layer.id, kind)}>
          {t(TEXTS[kind].change)}
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
          <div key={p.key}>
            {slider(
              t(`layers.${p.key}`),
              value[p.key],
              { min: Math.min(p.min, value[p.key]), max: Math.max(p.max, value[p.key]), step: p.step },
              shown(value[p.key], p.unit),
              PLACE,
              (v) => setTransform(clipId, layer.id, time, { [p.key]: v }),
            )}
          </div>
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

      {video()}
      {lottie()}
      {greenScreen()}
    </section>
  );
}
