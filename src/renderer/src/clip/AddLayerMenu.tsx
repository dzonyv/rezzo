import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addImage } from '../project/assets.ts';
import { pauseClip } from './playback.ts';
import { selectLayer } from './state.ts';

/** Kinds of layer the menu offers. */
const KINDS = ['image'] as const;

/** "Add": a menu of the kinds of layer that can go over the picture, added from the playhead on. */
export function AddLayerMenu({ clipId, time }: { clipId: string; time: number }) {
  const { t } = useTranslation();
  const menu = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);

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
    if (kind === 'image') {
      const id = await addImage(clipId, time);
      if (id) selectLayer(id);
    }
  };

  return (
    <details ref={menu} className="add-menu" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary title={t('layers.addHelp')}>{t('layers.add')}</summary>
      <div className="add-menu-items">
        {KINDS.map((kind) => (
          <button key={kind} type="button" onClick={() => void add(kind)}>
            {t(`layers.kinds.${kind}`)}
          </button>
        ))}
      </div>
    </details>
  );
}
