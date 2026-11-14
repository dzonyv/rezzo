import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TextLayer } from '../../../shared/project.ts';
import { MAX_TEXT_CHARS, MAX_TEXT_OUTLINE, MAX_TEXT_SIZE, MIN_TEXT_SIZE, TEXT_ALIGNS, type TextAlign, type TextStyle } from '../../../shared/text-style.ts';
import { setText, setTextStyle } from '../project/layers.ts';
import { projectStore, type EditLabel } from '../project/store.ts';
import { ColorInput, FontPicker } from './style-inputs.tsx';

const STYLE: EditLabel = 'history.textStyle';

/** Typing goes into the project once it pauses this long, as one undo step; leaving the field sends it at once. */
const TYPING_SETTLE_MS = 300;

/**
 * What a text layer says. Kept here while typing and sent to the project
 * when typing pauses or the field is left, so a word is one undo step
 * rather than one per letter. Save and close leave the field first
 * (commitActiveField), so nothing typed is lost.
 */
function TextField({ clipId, layer }: { clipId: string; layer: TextLayer }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(layer.text);
  const sent = useRef(layer.text);
  const timer = useRef(0);
  const latest = useRef(layer.text);

  // Undo, redo or another edit changed the text: show it.
  useEffect(() => {
    if (layer.text === sent.current) return;
    sent.current = layer.text;
    latest.current = layer.text;
    setDraft(layer.text);
  }, [layer.text]);

  const layerId = layer.id;
  const commit = () => {
    clearTimeout(timer.current);
    timer.current = 0;
    if (latest.current === sent.current) return;
    sent.current = latest.current;
    setText(clipId, layerId, latest.current);
  };
  // What's typed but not sent yet goes in when the panel closes.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (latest.current !== sent.current) setText(clipId, layerId, latest.current);
    },
    [clipId, layerId],
  );

  return (
    <label className="text-field">
      <span>{t('layers.text.label')}</span>
      <textarea
        value={draft}
        rows={3}
        maxLength={MAX_TEXT_CHARS}
        spellCheck={false}
        onChange={(e) => {
          latest.current = e.target.value;
          setDraft(e.target.value);
          clearTimeout(timer.current);
          timer.current = window.setTimeout(commit, TYPING_SETTLE_MS);
        }}
        onBlur={commit}
      />
    </label>
  );
}

/** A text layer's text and look: font, size, colours, outline, shadow and the band behind it. */
export function TextSection({ clipId, layer }: { clipId: string; layer: TextLayer }) {
  const { t } = useTranslation();
  const store = projectStore.getState();
  const style = layer.style;
  const set = (patch: Partial<TextStyle>) => setTextStyle(clipId, layer.id, patch);
  /** One undo step per drag of a slider; arrow keys make a step each. */
  const gesture = { onPointerDown: () => store.beginGesture(STYLE), onPointerUp: () => store.endGesture() };

  const color = (label: string, value: string, patch: (v: string) => Partial<TextStyle>) => (
    <label className="layer-color">
      <span>{label}</span>
      <ColorInput value={value} label={STYLE} onPick={(v) => set(patch(v))} />
    </label>
  );
  const slider = (label: string, value: number, min: number, max: number, patch: (v: number) => Partial<TextStyle>) => (
    <label className="layer-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={1} value={value} {...gesture} onChange={(e) => set(patch(Number(e.target.value)))} />
      <output>{t('layers.units.pixels', { value })}</output>
    </label>
  );

  return (
    <div className="layer-section text-section">
      {/* A new layer, or another one selected, starts the field afresh. */}
      <TextField key={layer.id} clipId={clipId} layer={layer} />
      <p className="dim hint">{t('layers.text.accentHelp')}</p>
      <FontPicker font={style.font} onPick={(font) => set({ font })} />
      <div className="layer-grid">
        {slider(t('layers.text.size'), style.size, MIN_TEXT_SIZE, MAX_TEXT_SIZE, (size) => ({ size }))}
        <label>
          <span>{t('layers.text.align')}</span>
          <select value={style.align} onChange={(e) => set({ align: e.target.value as TextAlign })}>
            {TEXT_ALIGNS.map((a) => (
              <option key={a} value={a}>
                {t(`layers.text.aligns.${a}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="layer-check">
          <input type="checkbox" checked={style.uppercase} onChange={(e) => set({ uppercase: e.target.checked })} />
          {t('layers.text.uppercase')}
        </label>
        <div className="layer-row">
          {color(t('layers.text.color'), style.color, (c) => ({ color: c }))}
          {color(t('layers.text.accent'), style.accent, (c) => ({ accent: c }))}
        </div>
        {slider(t('layers.text.outline'), style.outline.width, 0, MAX_TEXT_OUTLINE, (width) => ({ outline: { ...style.outline, width } }))}
        {style.outline.width > 0 && color(t('layers.text.outlineColor'), style.outline.color, (c) => ({ outline: { ...style.outline, color: c } }))}
        <label className="layer-check">
          <input type="checkbox" checked={style.shadow !== null} onChange={(e) => set({ shadow: e.target.checked ? { color: '#000000', blur: 18, offset: 6 } : null })} />
          {t('layers.text.shadow')}
        </label>
        {style.shadow && color(t('layers.text.shadowColor'), style.shadow.color, (c) => ({ shadow: { ...style.shadow!, color: c } }))}
        <label className="layer-check">
          <input type="checkbox" checked={style.band !== null} onChange={(e) => set({ band: e.target.checked ? { color: '#000000' } : null })} />
          {t('layers.text.band')}
        </label>
        {style.band && color(t('layers.text.bandColor'), style.band.color, (c) => ({ band: { color: c } }))}
      </div>
    </div>
  );
}
