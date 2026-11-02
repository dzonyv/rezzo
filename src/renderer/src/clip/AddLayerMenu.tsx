import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ASSET_KINDS } from '../../../shared/assets.ts';
import { addImage } from '../project/assets.ts';
import { pauseClip } from './playback.ts';
import { selectLayer } from './state.ts';

/** "Add": a menu of the kinds of layer that can go over the picture, added from the playhead on. */
export function AddLayerMenu({ clipId, time }: { clipId: string; time: number }) {
  const { t } = useTranslation();
  const menu = useRef<HTMLDetailsElement>(null);

  const add = async (kind: (typeof ASSET_KINDS)[number]) => {
    menu.current!.open = false;
    pauseClip();
    if (kind === 'image') {
      const id = await addImage(clipId, time);
      if (id) selectLayer(id);
    }
  };

  return (
    <details ref={menu} className="add-menu">
      <summary title={t('layers.addHelp')}>{t('layers.add')}</summary>
      <div className="add-menu-items">
        {ASSET_KINDS.map((kind) => (
          <button key={kind} type="button" onClick={() => void add(kind)}>
            {t(`layers.kinds.${kind}`)}
          </button>
        ))}
      </div>
    </details>
  );
}
