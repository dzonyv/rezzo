import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keyAt, valueAt } from '../../../shared/framing.ts';
import { fps, workingFrameRate } from '../../../shared/frames.ts';
import { LAYOUTS, MAX_ZOOM, videoLayerOf, type Clip, type Source } from '../../../shared/project.ts';
import { formatClipTime } from '../format.ts';
import { nudgeClip, renameClip } from '../project/clips.ts';
import { addKeyframe, deleteKeyframe, setFraming, setLayout, setSmooth } from '../project/framing.ts';
import { projectStore } from '../project/store.ts';
import { isTypingTarget } from '../ui/focus.ts';
import { ClipPreview } from './ClipPreview.tsx';
import { ClipTimeline } from './ClipTimeline.tsx';
import { FramingOverlay, propertyFor, regionFor, zoomed } from './FramingOverlay.tsx';
import { currentPlayer, seekClip, toggleClip, useClipPlayback } from './playback.ts';
import { openClip } from './state.ts';

const EDGES = ['start', 'end'] as const;

/** The open clip: its range, the 9:16 preview with framing, layouts and keyframes. */
export function ClipEditor({ clip, source }: { clip: Clip; source: Source }) {
  const { t } = useTranslation();
  const store = projectStore.getState();
  const [half, setHalf] = useState<'top' | 'bottom'>('top');
  const status = useClipPlayback((s) => s.status);
  const playing = useClipPlayback((s) => s.playing);
  const sourceSize = useClipPlayback((s) => s.sourceSize);
  const playerTime = useClipPlayback((s) => s.time);

  const rate = workingFrameRate(source);
  const frame = 1 / fps(rate);
  // Until the player is ready, the clip's first frame is "now".
  const time = status === 'ready' ? Math.min(Math.max(playerTime, clip.start), clip.end - frame) : clip.start;
  const layer = videoLayerOf(clip);
  const layout = valueAt(layer.layout, time);
  const property = propertyFor(layout, half);
  const keys = layer[property];
  const keyIndex = keyAt(keys, time, rate);
  const value = valueAt(keys, time);
  /** Trimming moves an edge by about a tenth of a second. */
  const trimStep = Math.max(1, Math.round(fps(rate) / 10));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.ctrlKey || e.altKey) return;
      const player = currentPlayer();
      if (e.code === 'Space') {
        // Space plays even with a button focused (after clicking a layout, say);
        // Enter still presses the button.
        e.preventDefault();
        toggleClip();
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && player) {
        e.preventDefault();
        const by = (e.shiftKey ? 1 : frame) * (e.key === 'ArrowLeft' ? -1 : 1);
        player.pause();
        seekClip(player.currentTime + by);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [frame]);

  return (
    <section className="clip-editor">
      <header>
        <input
          className="clip-name"
          aria-label={t('clipEditor.name')}
          value={clip.name}
          onFocus={() => store.beginGesture('history.renameClip')}
          onChange={(e) => renameClip(clip.id, e.target.value)}
          onBlur={() => store.endGesture()}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <button type="button" className="icon" aria-label={t('clipEditor.close')} title={t('clipEditor.close')} onClick={() => openClip(null)}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      </header>

      <div className="clip-range">
        {EDGES.map((edge) => (
          <div key={edge} className="edge">
            <span className="dim">{t(`clipEditor.${edge}`)}</span>
            <button type="button" className="icon" aria-label={t('clipEditor.earlier', { what: t(`clipEditor.${edge}`) })} title={t('clipEditor.earlier', { what: t(`clipEditor.${edge}`) })} onClick={() => nudgeClip(clip.id, edge, -trimStep)}>
              ‹
            </button>
            <span className="value">{formatClipTime(clip[edge])}</span>
            <button type="button" className="icon" aria-label={t('clipEditor.later', { what: t(`clipEditor.${edge}`) })} title={t('clipEditor.later', { what: t(`clipEditor.${edge}`) })} onClick={() => nudgeClip(clip.id, edge, trimStep)}>
              ›
            </button>
          </div>
        ))}
      </div>

      <ClipPreview clip={clip} source={source}>
        <FramingOverlay clipId={clip.id} layout={layout} half={half} onHalf={setHalf} time={time} sourceSize={sourceSize} />
      </ClipPreview>

      <div className="transport">
        <button type="button" disabled={status !== 'ready'} onClick={toggleClip}>
          {playing ? t('clipEditor.pause') : t('clipEditor.play')}
        </button>
        <span className="time">
          {t('clipEditor.time', { current: formatClipTime(time - clip.start), total: formatClipTime(clip.end - clip.start) })}
        </span>
      </div>
      <ClipTimeline clip={clip} layout={layer.layout} keys={keys} time={time} />

      <div className="layouts" role="group" aria-label={t('clipEditor.layout')}>
        {LAYOUTS.map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={layout === l}
            className={layout === l ? 'selected' : undefined}
            title={t(`clipEditor.layoutHelp.${l}`)}
            onClick={() => setLayout(clip.id, time, l)}
          >
            {t(`clipEditor.layouts.${l}`)}
          </button>
        ))}
      </div>
      <p className="dim hint">
        {t('clipEditor.dragHint')}
        {layout === 'split' && ` ${t('clipEditor.editing', { what: t(`clipEditor.${half}`) })}`}
      </p>

      <label className="zoom">
        <span>{t('clipEditor.zoom')}</span>
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={value.zoom}
          disabled={!sourceSize}
          onPointerDown={() => store.beginGesture('history.zoomFrame')}
          onPointerUp={() => store.endGesture()}
          onChange={(e) => {
            if (!sourceSize) return;
            const region = regionFor(layout, half);
            const next = zoomed(value, property, region, sourceSize, Number(e.target.value), region.x + region.w / 2, region.y + region.h / 2);
            setFraming(clip.id, 'history.zoomFrame', property, time, next);
          }}
        />
      </label>

      <div className="keyframes">
        <button type="button" disabled={keyIndex >= 0} onClick={() => addKeyframe(clip.id, property, time)}>
          <span className="diamond" aria-hidden="true" />
          {t('clipEditor.addKeyframe')}
        </button>
        <label className={keyIndex < 0 || keyIndex === keys.length - 1 ? 'disabled' : undefined}>
          <input
            type="checkbox"
            disabled={keyIndex < 0 || keyIndex === keys.length - 1}
            checked={keyIndex >= 0 && keys[keyIndex]!.ease === 'smooth'}
            onChange={(e) => setSmooth(clip.id, property, keyIndex, e.target.checked)}
          />
          {t('clipEditor.smooth')}
        </label>
        <button type="button" disabled={keyIndex < 0 || keys.length === 1} onClick={() => deleteKeyframe(clip.id, property, keyIndex)}>
          {t('clipEditor.deleteKeyframe')}
        </button>
      </div>
      <p className="dim hint">{t('clipEditor.keyframeHelp')}</p>
    </section>
  );
}
