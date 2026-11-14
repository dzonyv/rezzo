import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BUILT_IN_STYLES, CAPTION_MODES, ENTRANCES, HIGHLIGHTS, MAX_ACTIVE_SCALE, MAX_CAPTION_SIZE, MAX_LINE_CHARS, MIN_CAPTION_SIZE, MIN_LINE_CHARS,
  type CaptionStyle,
} from '../../../shared/caption-style.ts';
import { cssFamily, FALLBACK_FONT } from '../../../shared/fonts.ts';
import { keyAt } from '../../../shared/framing.ts';
import type { CaptionTrack } from '../../../shared/captions.ts';
import type { FrameRate } from '../../../shared/frames.ts';
import type { CaptionLayer } from '../../../shared/project.ts';
import {
  addCaptionKey, addCaptions, deleteCaptionKey, removeCaptions, setCaptionKeySmooth, setCaptionStyle,
} from '../project/captions.ts';
import { projectStore, type EditLabel } from '../project/store.ts';
import { setSettings, useSettings } from '../settings.ts';
import { notify } from '../ui/prompts.ts';
import { ColorInput, FontPicker } from './style-inputs.tsx';

const STYLE: EditLabel = 'history.captionStyle';

interface Props {
  clipId: string;
  layer: CaptionLayer | null;
  /** The position keyframes of the layout on screen. */
  track: CaptionTrack;
  /** Source seconds of the frame on screen; position keyframes land there. */
  time: number;
  rate: FrameRate;
}

/** A style as a CSS look, for the style buttons: the sample in the style's font and colours. */
function sampleLook(style: CaptionStyle): React.CSSProperties {
  // The buttons are small; outlines and shadows shrink with the text.
  const scale = 18 / style.size;
  return {
    fontFamily: `${cssFamily(style.font.family)}, ${cssFamily(FALLBACK_FONT.family)}`,
    fontWeight: style.font.weight,
    color: style.color,
    textTransform: style.uppercase ? 'uppercase' : 'none',
    WebkitTextStroke: style.outline.width > 0 ? `${style.outline.width * 2 * scale}px ${style.outline.color}` : undefined,
    paintOrder: 'stroke fill',
    textShadow: style.shadow ? `0 ${style.shadow.offset * scale}px ${style.shadow.blur * scale}px ${style.shadow.color}` : undefined,
  };
}

function StyleSample({ style }: { style: CaptionStyle }) {
  const { t } = useTranslation();
  const words = t('captions.sample').split(' ');
  const h = style.highlight;
  return (
    <span className="caption-sample" style={sampleLook(style)}>
      {words.map((w, i) => {
        // The middle word is the one "being spoken".
        const active = i === 1 && h.kind !== 'none';
        return (
          <span key={i} style={active ? { color: h.color, background: h.kind === 'box' ? h.box : undefined } : undefined} className={active && h.kind === 'box' ? 'boxed' : undefined}>
            {w}
          </span>
        );
      })}
    </span>
  );
}

/** The clip's caption settings: add or remove them, pick and tune a style, save it for later. */
export function CaptionPanel({ clipId, layer, track, time, rate }: Props) {
  const { t } = useTranslation();
  const saved = useSettings((s) => s.captionStyles) ?? [];
  const [name, setName] = useState('');

  if (!layer) {
    return (
      <section className="caption-panel">
        <h3>{t('captions.title')}</h3>
        <p className="dim">{t('captions.none')}</p>
        <button type="button" onClick={() => addCaptions(clipId)}>
          {t('captions.add')}
        </button>
      </section>
    );
  }

  const style = layer.style;
  const set = (patch: Partial<CaptionStyle>, label?: EditLabel) => setCaptionStyle(clipId, patch, label);
  const store = projectStore.getState();
  /** One undo step per drag of a slider; arrow keys make a step each. */
  const sliderGesture = {
    onPointerDown: () => store.beginGesture('history.captionStyle'),
    onPointerUp: () => store.endGesture(),
  };


  const saveStyle = async () => {
    const n = name.trim();
    if (!n) return;
    try {
      await setSettings({ captionStyles: [...saved.filter((s) => s.name !== n), { name: n, style }] });
      setName('');
      notify('info', t('captions.saved', { name: n }));
    } catch {
      notify('error', t('captions.saveFailed'));
    }
  };
  const makeDefault = async () => {
    try {
      await setSettings({ defaultCaptionStyle: style });
      notify('info', t('captions.madeDefault'));
    } catch {
      notify('error', t('captions.saveFailed'));
    }
  };

  const keys = layer[track];
  const keyIndex = keyAt(keys, time, rate);
  const color = (label: string, value: string, patch: (v: string) => Partial<CaptionStyle>) => (
    <label className="caption-color">
      <span>{label}</span>
      <ColorInput value={value} label={STYLE} onPick={(v) => set(patch(v))} />
    </label>
  );
  const slider = (label: string, value: number, min: number, max: number, step: number, patch: (v: number) => Partial<CaptionStyle>) => (
    <label className="caption-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} {...sliderGesture} onChange={(e) => set(patch(Number(e.target.value)))} />
      <output>{Number.isInteger(step) ? value : value.toFixed(2)}</output>
    </label>
  );

  return (
    <section className="caption-panel">
      <header>
        <h3>{t('captions.title')}</h3>
        <button type="button" onClick={() => removeCaptions(clipId)}>
          {t('captions.remove')}
        </button>
      </header>

      <div className="caption-styles" role="group" aria-label={t('captions.style')}>
        {BUILT_IN_STYLES.map((b) => (
          <button key={b.id} type="button" className="caption-style" title={t(`captions.styles.${b.id}` as 'captions.styles.classic')} onClick={() => set({ ...b.style })}>
            <StyleSample style={b.style} />
            <span className="dim">{t(`captions.styles.${b.id}` as 'captions.styles.classic')}</span>
          </button>
        ))}
        {saved.map((s) => (
          <div key={s.name} className="caption-style saved">
            <button type="button" title={s.name} onClick={() => set({ ...s.style })}>
              <StyleSample style={s.style} />
              <span className="dim">{s.name}</span>
            </button>
            <button
              type="button"
              className="icon"
              aria-label={t('captions.deleteStyle', { name: s.name })}
              title={t('captions.deleteStyle', { name: s.name })}
              onClick={() => void setSettings({ captionStyles: saved.filter((x) => x.name !== s.name) }).catch(() => notify('error', t('captions.saveFailed')))}
            >
              <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <FontPicker font={style.font} onPick={(font) => set({ font })} />

      <div className="caption-grid">
        {slider(t('captions.size'), style.size, MIN_CAPTION_SIZE, MAX_CAPTION_SIZE, 1, (size) => ({ size }))}
        <label className="caption-check">
          <input type="checkbox" checked={style.uppercase} onChange={(e) => set({ uppercase: e.target.checked })} />
          {t('captions.uppercase')}
        </label>
        {color(t('captions.color'), style.color, (c) => ({ color: c }))}
        {slider(t('captions.outline'), style.outline.width, 0, 24, 1, (width) => ({ outline: { ...style.outline, width } }))}
        {color(t('captions.outlineColor'), style.outline.color, (c) => ({ outline: { ...style.outline, color: c } }))}
        <label className="caption-check">
          <input
            type="checkbox"
            checked={style.shadow !== null}
            onChange={(e) => set({ shadow: e.target.checked ? { color: '#000000', blur: 14, offset: 4 } : null })}
          />
          {t('captions.shadow')}
        </label>
        {style.shadow && color(t('captions.shadowColor'), style.shadow.color, (c) => ({ shadow: { ...style.shadow!, color: c } }))}

        <label>
          <span>{t('captions.highlight')}</span>
          <select value={style.highlight.kind} onChange={(e) => set({ highlight: { ...style.highlight, kind: e.target.value as CaptionStyle['highlight']['kind'] } })}>
            {HIGHLIGHTS.map((h) => (
              <option key={h} value={h}>
                {t(`captions.highlights.${h}`)}
              </option>
            ))}
          </select>
        </label>
        {style.highlight.kind !== 'none' && color(t('captions.highlightColor'), style.highlight.color, (c) => ({ highlight: { ...style.highlight, color: c } }))}
        {style.highlight.kind === 'box' && color(t('captions.boxColor'), style.highlight.box, (c) => ({ highlight: { ...style.highlight, box: c } }))}
        {style.highlight.kind !== 'none' &&
          slider(t('captions.activeScale'), style.activeScale, 1, MAX_ACTIVE_SCALE, 0.01, (activeScale) => ({ activeScale }))}

        <label>
          <span>{t('captions.mode')}</span>
          <select value={style.mode} onChange={(e) => set({ mode: e.target.value as CaptionStyle['mode'] })}>
            {CAPTION_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`captions.modes.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('captions.entrance')}</span>
          <select value={style.entrance} onChange={(e) => set({ entrance: e.target.value as CaptionStyle['entrance'] })}>
            {ENTRANCES.map((m) => (
              <option key={m} value={m}>
                {t(`captions.entrances.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('captions.lines')}</span>
          <select value={style.lines} onChange={(e) => set({ lines: Number(e.target.value) as 1 | 2 })}>
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </label>
        {slider(t('captions.maxChars'), style.maxChars, MIN_LINE_CHARS, MAX_LINE_CHARS, 1, (maxChars) => ({ maxChars }))}
      </div>

      <div className="keyframes">
        <span className="dim">{t('captions.position')}</span>
        <button type="button" disabled={keyIndex >= 0} onClick={() => addCaptionKey(clipId, track, time)}>
          <span className="diamond" aria-hidden="true" />
          {t('clipEditor.addKeyframe')}
        </button>
        <label className={keyIndex < 0 || keyIndex === keys.length - 1 ? 'disabled' : undefined}>
          <input
            type="checkbox"
            disabled={keyIndex < 0 || keyIndex === keys.length - 1}
            checked={keyIndex >= 0 && keys[keyIndex]!.ease === 'smooth'}
            onChange={(e) => setCaptionKeySmooth(clipId, track, keyIndex, e.target.checked)}
          />
          {t('clipEditor.smooth')}
        </label>
        <button type="button" disabled={keyIndex < 0 || keys.length === 1} onClick={() => deleteCaptionKey(clipId, track, keyIndex)}>
          {t('clipEditor.deleteKeyframe')}
        </button>
      </div>
      <p className="dim hint">{t('captions.positionHelp')}</p>

      <div className="caption-row">
        <input
          aria-label={t('captions.styleName')}
          placeholder={t('captions.styleName')}
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void saveStyle()}
        />
        <button type="button" disabled={!name.trim()} onClick={() => void saveStyle()}>
          {t('captions.save')}
        </button>
        <button type="button" onClick={() => void makeDefault()}>
          {t('captions.makeDefault')}
        </button>
      </div>
    </section>
  );
}
