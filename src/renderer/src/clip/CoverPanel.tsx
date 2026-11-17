import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Asset } from '../../../shared/assets.ts';
import { COVER_FORMATS, coverOf, type CoverFormat } from '../../../shared/cover.ts';
import { STILL_EFFECTS, type EffectName } from '../../../shared/effects.ts';
import { fps, type FrameRate } from '../../../shared/frames.ts';
import { valueAt, type Size } from '../../../shared/framing.ts';
import { isPlaced, videoLayerOf, type Clip, type Layout } from '../../../shared/project.ts';
import { outputTime } from '../../../shared/skips.ts';
import { useAnalysis } from '../analysis/store.ts';
import { saveCover } from '../cover/save-cover.ts';
import { useCoverSuggestions } from '../cover/suggest.ts';
import { formatClipTime } from '../format.ts';
import { addCoverImageFile } from '../project/assets.ts';
import type { FramingTarget } from '../project/framing.ts';
import { addCoverCutout, addCoverEffect, addCoverText, followClipFraming, setCoverInVideo, setCoverTime, stepCoverTime } from '../project/cover.ts';
import { projectStore, type EditLabel } from '../project/store.ts';
import { CutoutPanel } from './CutoutPanel.tsx';
import { EffectPanel } from './EffectPanel.tsx';
import { propertyFor, ZoomSlider } from './FramingOverlay.tsx';
import { LayerPanel } from './LayerPanel.tsx';
import { currentPlayer } from './playback.ts';
import { selectLayer } from './state.ts';

const MOMENT: EditLabel = 'history.coverMoment';
const COVER: FramingTarget = 'cover';

interface Props {
  /** The clip as it is in the document. */
  clip: Clip;
  /** The cover as a clip (coverClip), as the preview shows it. */
  shown: Clip;
  selectedId: string | null;
  assets: readonly Asset[];
  rate: FrameRate;
  half: 'top' | 'bottom';
  sourceSize: Size | null;
  /** The clip is ready to be drawn, so the cover can be saved. */
  ready: boolean;
}

/**
 * The Cover drawer: the selected layer on the cover, or the cover's
 * framing and what can go on it; then saving it.
 */
export function CoverPanel({ clip, shown, selectedId, assets, rate, half, sourceSize, ready }: Props) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState<CoverFormat | null>(null);
  const cover = coverOf(clip);
  const selected = shown.layers.find((l) => l.id === selectedId);
  const video = videoLayerOf(shown);
  const layout: Layout = valueAt(video.layout, cover.time);
  const property = propertyFor(layout, half);
  const value = valueAt(video[property], cover.time);

  const save = async (format: CoverFormat) => {
    setSaving(format);
    try {
      await saveCover(clip, format);
    } finally {
      setSaving(null);
    }
  };

  const addText = () => selectLayer(addCoverText(clip.id, t('cover.placeholder')));
  // One cutout is enough: the tile selects it once it's there.
  const cutout = cover.layers.find((l) => l.kind === 'cutout');
  const addCutout = () => selectLayer(cutout?.id ?? addCoverCutout(clip.id));
  // One of each effect: a tile selects the one the cover has.
  const effectOf = (effect: EffectName) => cover.layers.find((l) => l.kind === 'effect' && l.effect === effect);
  const addEffect = (effect: EffectName) => selectLayer(effectOf(effect)?.id ?? addCoverEffect(clip.id, effect));
  const addImage = async () => {
    const id = await addCoverImageFile(clip.id);
    if (id) selectLayer(id);
  };

  return (
    <>
      {selected?.kind === 'cutout' ? (
        <CutoutPanel clipId={clip.id} layer={selected} />
      ) : selected?.kind === 'effect' ? (
        <EffectPanel clipId={clip.id} layer={selected} time={cover.time} rate={rate} onCover />
      ) : selected && isPlaced(selected) ? (
        <LayerPanel
          clip={shown}
          layer={selected}
          asset={selected.kind === 'text' ? undefined : assets.find((a) => a.id === selected.assetId)}
          assets={assets}
          time={cover.time}
          rate={rate}
          overLimit={false}
          onCover
        />
      ) : (
        <>
          <p className="dim hint">{t('cover.hint')}</p>
          <SuggestedFrames clip={clip} rate={rate} ready={ready} />
          <section className="cover-framing">
            <h3>{t('cover.framing')}</h3>
            <p className="dim hint">{t(clip.cover?.video ? 'cover.ownFraming' : 'cover.clipFraming')}</p>
            <ZoomSlider clipId={clip.id} layout={layout} half={half} value={value} time={cover.time} sourceSize={sourceSize} target={COVER} />
            <button type="button" disabled={!clip.cover?.video} onClick={() => followClipFraming(clip.id)}>
              {t('cover.useClipFraming')}
            </button>
          </section>
        </>
      )}

      <div className="add-tiles" role="group" aria-label={t('cover.addHelp')}>
        <button type="button" className="tile" onClick={addText}>
          {t('layers.kinds.text')}
        </button>
        <button type="button" className="tile" onClick={() => void addImage()}>
          {t('layers.kinds.image')}
        </button>
        <button type="button" className="tile" title={t('cutout.addHelp')} onClick={addCutout}>
          {t('layers.kinds.cutout')}
        </button>
      </div>
      <p className="dim hint">{t('cover.titleHint')}</p>

      <section className="cover-effects">
        <h3>{t('cover.effects')}</h3>
        <div className="cover-effect-tiles" role="group" aria-label={t('cover.effects')}>
          {STILL_EFFECTS.map((effect) => (
            <button key={effect} type="button" aria-pressed={effectOf(effect) !== undefined} onClick={() => addEffect(effect)}>
              {t(`effects.names.${effect}`)}
            </button>
          ))}
        </div>
        <p className="dim hint">{t('cover.effectsHelp')}</p>
      </section>

      <section className="cover-save">
        <h3>{t('cover.save')}</h3>
        <div className="layer-row">
          {COVER_FORMATS.map((format) => (
            <button key={format} type="button" className={format === 'png' ? 'primary' : undefined} disabled={!ready || saving !== null} onClick={() => void save(format)}>
              {t(`cover.saveAs.${format}`)}
            </button>
          ))}
        </div>
        <p className="dim hint">{t('cover.saveHelp')}</p>
        <label className="layer-check">
          <input type="checkbox" checked={cover.inVideo} onChange={(e) => setCoverInVideo(clip.id, e.target.checked)} />
          {t('cover.inVideo')}
        </label>
        <p className="dim hint">{t('cover.inVideoHelp')}</p>
      </section>
    </>
  );
}

/**
 * A few frames the analysis thinks make a good cover, as pictures: pressing
 * one moves the cover there. They come once the clip's analysis is done.
 */
function SuggestedFrames({ clip, rate, ready }: { clip: Clip; rate: FrameRate; ready: boolean }) {
  const { t } = useTranslation();
  const analysis = useAnalysis((s) => s.analysis);
  const status = useAnalysis((s) => s.status);
  const player = ready ? currentPlayer() : null;
  const source = useMemo(() => (player ? { file: player.file, media: player.media } : null), [player]);
  const suggestions = useCoverSuggestions(clip, analysis, source);
  const time = coverOf(clip).time;
  const frame = 1 / fps(rate);
  return (
    <section className="cover-suggestions">
      <h3>{t('cover.suggested')}</h3>
      {suggestions === null ? (
        <p className="dim hint">{status === 'failed' ? t('cover.noSuggestions') : t('cover.suggesting')}</p>
      ) : suggestions.length === 0 ? (
        <p className="dim hint">{t('cover.noSuggestions')}</p>
      ) : (
        <div className="cover-frames">
          {suggestions.map((s) => {
            const at = formatClipTime(outputTime(clip, s.t));
            const chosen = Math.abs(s.t - time) < frame;
            return (
              <button
                key={s.t}
                type="button"
                aria-pressed={chosen}
                aria-label={t('cover.useFrame', { time: at })}
                title={t('cover.useFrame', { time: at })}
                onClick={() => setCoverTime(clip.id, s.t)}
              >
                <img src={s.picture} alt="" />
                <span>{at}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Under the cover, where the timeline is for the clip: which moment of the
 * clip the cover holds, a frame at a time or dragged along the clip.
 */
export function CoverMoment({ clip, rate }: { clip: Clip; rate: FrameRate }) {
  const { t } = useTranslation();
  const store = projectStore.getState();
  const time = coverOf(clip).time;
  const frame = 1 / fps(rate);
  const step = (by: number) => stepCoverTime(clip.id, by);
  return (
    <div className="cover-moment">
      <span className="dim">{t('cover.moment')}</span>
      <button type="button" className="icon" aria-label={t('cover.earlier')} title={t('cover.earlier')} onClick={() => step(-1)}>
        ‹
      </button>
      <span className="value">{formatClipTime(outputTime(clip, time))}</span>
      <button type="button" className="icon" aria-label={t('cover.later')} title={t('cover.later')} onClick={() => step(1)}>
        ›
      </button>
      <input
        type="range"
        aria-label={t('cover.moment')}
        min={clip.start}
        max={clip.end - frame}
        step={frame}
        value={time}
        onPointerDown={() => store.beginGesture(MOMENT)}
        onPointerUp={() => store.endGesture()}
        onChange={(e) => setCoverTime(clip.id, Number(e.target.value))}
      />
    </div>
  );
}
