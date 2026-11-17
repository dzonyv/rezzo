import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_CUTOUT_GLOW, MAX_CUTOUT_OUTLINE, type CutoutStyle } from '../../../shared/cutout.ts';
import type { CutoutLayer } from '../../../shared/project.ts';
import { setCutoutStyle } from '../project/cover.ts';
import { deleteLayer } from '../project/layers.ts';
import { projectStore, type EditLabel } from '../project/store.ts';
import { useClipPlayback } from './playback.ts';
import { selectLayer } from './state.ts';
import { ColorInput } from './style-inputs.tsx';

const STYLE: EditLabel = 'history.cutoutStyle';

/** The cutout's two looks, each with how big it is and the most it can be. */
const PARTS = [
  { name: 'outline', size: 'width', max: MAX_CUTOUT_OUTLINE },
  { name: 'glow', size: 'size', max: MAX_CUTOUT_GLOW },
] as const;

/** The people cut out on the cover, when selected: their outline and glow. */
export function CutoutPanel({ clipId, layer }: { clipId: string; layer: CutoutLayer }) {
  const { t } = useTranslation();
  const store = projectStore.getState();
  const finding = useClipPlayback((s) => s.findingPeople);
  /** One undo step per drag of a slider; arrow keys make a step each. */
  const gesture = { onPointerDown: () => store.beginGesture(STYLE), onPointerUp: () => store.endGesture() };

  const part = ({ name, size, max }: (typeof PARTS)[number]) => {
    const style: CutoutStyle[typeof name] = layer.style[name];
    const value = 'width' in style ? style.width : style.size;
    return (
      <Fragment key={name}>
        <label className="layer-slider">
          <span>{t(`cutout.${name}`)}</span>
          <input type="range" min={0} max={max} step={1} value={value} {...gesture} onChange={(e) => setCutoutStyle(clipId, layer.id, name, { [size]: Number(e.target.value) })} />
          <output>{t('layers.units.pixels', { value })}</output>
        </label>
        {value > 0 && (
          <label className="layer-color">
            <span>{t(`cutout.${name}Color`)}</span>
            <ColorInput value={style.color} label={STYLE} onPick={(color) => setCutoutStyle(clipId, layer.id, name, { color })} />
          </label>
        )}
      </Fragment>
    );
  };

  const remove = () => {
    deleteLayer(clipId, layer.id);
    selectLayer(null);
  };

  return (
    <div className="layer-section cutout-section">
      <h3>{t('layers.kinds.cutout')}</h3>
      <p className="dim hint" role="status">
        {finding ? t('cutout.finding') : t('cutout.help')}
      </p>
      <div className="layer-grid">
        {PARTS.map(part)}
      </div>
      <div className="layer-row">
        <button type="button" onClick={remove}>
          {t('layers.delete')}
        </button>
      </div>
    </div>
  );
}
