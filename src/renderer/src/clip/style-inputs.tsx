/** Inputs the caption and text panels share: a colour, and a font with its weight. */
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { fontChoices, type FontRef } from '../../../shared/fonts.ts';
import { isAvailable, preloadFont } from '../fonts/registry.ts';
import { projectStore, type EditLabel } from '../project/store.ts';
import { useSettings } from '../settings.ts';
import { notify } from '../ui/prompts.ts';

const WEIGHT_NAMES = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

/**
 * A colour input whose visit to the picker is one undo step, named
 * `label`. The step opens with the first colour picked and closes when the
 * picker does (the native "change" event). Focus isn't used: it outlasts
 * the picker, and a blur would end whatever gesture comes next, such as a
 * drag in the preview.
 */
export function ColorInput({ value, label, onPick }: { value: string; label: EditLabel; onPick: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const open = useRef(false);
  useEffect(() => {
    const el = input.current!;
    const close = () => {
      if (!open.current) return;
      open.current = false;
      projectStore.getState().endGesture();
    };
    el.addEventListener('change', close);
    return () => {
      el.removeEventListener('change', close);
      close();
    };
  }, []);
  return (
    <input
      ref={input}
      type="color"
      value={value}
      onChange={(e) => {
        if (!open.current) {
          open.current = true;
          projectStore.getState().beginGesture(label);
        }
        onPick(e.target.value);
      }}
    />
  );
}

/**
 * The font's family and weight, a button that adds a font of the user's
 * own, and a warning when the font isn't on this computer (the fallback is
 * drawn instead).
 */
export function FontPicker({ font, onPick }: { font: FontRef; onPick: (font: FontRef) => void }) {
  const { t } = useTranslation();
  const custom = useSettings((s) => s.fonts) ?? [];
  const choices = fontChoices(custom);

  // The style buttons and font list show fonts that may not have been used yet.
  const families = JSON.stringify(choices);
  useEffect(() => {
    for (const c of JSON.parse(families) as typeof choices) for (const weight of c.weights) preloadFont({ family: c.family, weight });
  }, [families]);

  const family = choices.find((c) => c.family === font.family);
  const fontHere = isAvailable(font);

  const pickFont = (f: FontRef) => {
    preloadFont(f);
    onPick(f);
  };
  const pickFamily = (name: string) => {
    const weights = choices.find((c) => c.family === name)?.weights ?? [];
    // The weight nearest the one in use.
    const weight = weights.reduce((best, w) => (Math.abs(w - font.weight) < Math.abs(best - font.weight) ? w : best), weights[0] ?? 400);
    pickFont({ family: name, weight });
  };

  const addFont = async () => {
    const result = await window.rezzo.invoke('fonts:add');
    if (!result) return;
    if (!result.ok) {
      notify('error', result.error === 'built-in' ? t('captions.fontBuiltIn', { family: result.family }) : t('captions.fontUnreadable'));
      return;
    }
    const { family: f, weight } = result.font;
    notify('info', t('captions.fontAdded', { family: f }));
    if (result.missing.length > 0) notify('error', t('captions.fontLacks', { family: f, letters: result.missing.join(' ') }));
    pickFont({ family: f, weight });
  };

  return (
    <>
      <div className="caption-row">
        <label>
          <span>{t('captions.font')}</span>
          <select value={font.family} onChange={(e) => pickFamily(e.target.value)}>
            {choices.map((c) => (
              <option key={c.family} value={c.family}>
                {c.family}
              </option>
            ))}
            {!family && <option value={font.family}>{t('captions.notHere', { family: font.family })}</option>}
          </select>
        </label>
        <label>
          <span>{t('captions.weight')}</span>
          <select value={font.weight} onChange={(e) => pickFont({ family: font.family, weight: Number(e.target.value) })}>
            {(family?.weights.includes(font.weight) ? family.weights : [...(family?.weights ?? []), font.weight].sort((a, b) => a - b)).map((w) => (
              <option key={w} value={w}>
                {WEIGHT_NAMES.includes(w as (typeof WEIGHT_NAMES)[number]) ? t(`captions.weights.${w as (typeof WEIGHT_NAMES)[number]}`) : w}
              </option>
            ))}
          </select>
        </label>
        <button type="button" title={t('captions.addFontHelp')} onClick={() => void addFont()}>
          {t('captions.addFont')}
        </button>
      </div>
      {!fontHere && <p className="caption-warning">{t('captions.fontMissing', { family: `${font.family} ${font.weight}` })}</p>}
    </>
  );
}
