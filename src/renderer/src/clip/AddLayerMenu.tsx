import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EFFECT_GROUPS, EFFECT_NAMES, EFFECTS, type EffectName } from '../../../shared/effects.ts';
import { addLayerFile } from '../project/assets.ts';
import { addEffectLayer } from '../project/layers.ts';
import { pauseClip } from './playback.ts';
import { selectLayer } from './state.ts';

/** Kinds of file layer the menu offers. */
const KINDS = ['image', 'video', 'lottie'] as const;

/**
 * "Add": a menu of the kinds of layer that can go over the picture, added
 * from the playhead on. "Effect" turns it into the effect library, grouped.
 */
export function AddLayerMenu({ clipId, time }: { clipId: string; time: number }) {
  const { t } = useTranslation();
  const menu = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const [library, setLibrary] = useState(false);

  // An open menu closes on a press anywhere else, or on Escape.
  useEffect(() => {
    if (!open) return;
    const close = () => {
      if (menu.current) menu.current.open = false;
    };
    const onPointer = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // The editor's own Escape (leaving a selected layer) waits for the next press.
      e.stopImmediatePropagation();
      close();
    };
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const add = async (kind: (typeof KINDS)[number]) => {
    menu.current!.open = false;
    pauseClip();
    const id = await addLayerFile(kind, clipId, time);
    if (id) selectLayer(id);
  };

  const addEffect = (effect: EffectName) => {
    menu.current!.open = false;
    pauseClip();
    const id = addEffectLayer(clipId, effect, time);
    if (id) selectLayer(id);
  };

  return (
    <details
      ref={menu}
      className="add-menu"
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
        if (!e.currentTarget.open) setLibrary(false);
      }}
    >
      <summary title={t('layers.addHelp')}>{t('layers.add')}</summary>
      {library ? (
        <div className="add-menu-items effect-library">
          <button type="button" className="back" onClick={() => setLibrary(false)}>
            ‹ {t('layers.add')}
          </button>
          {EFFECT_GROUPS.map((group) => (
            <div key={group} className="effect-group" role="group" aria-label={t(`effects.groups.${group}`)}>
              <h4 className={`effect-group-name ${group}`}>{t(`effects.groups.${group}`)}</h4>
              {EFFECT_NAMES.filter((name) => EFFECTS[name].group === group).map((name) => (
                <button key={name} type="button" onClick={() => addEffect(name)}>
                  {t(`effects.names.${name}`)}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="add-menu-items">
          {KINDS.map((kind) => (
            <button key={kind} type="button" onClick={() => void add(kind)}>
              {t(`layers.kinds.${kind}`)}
            </button>
          ))}
          <button type="button" onClick={() => setLibrary(true)}>
            {t('layers.kinds.effect')} ›
          </button>
        </div>
      )}
    </details>
  );
}
