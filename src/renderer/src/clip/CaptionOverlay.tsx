import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { captionBox } from '../../../shared/captions.ts';
import { OUTPUT, valueAt } from '../../../shared/framing.ts';
import type { CaptionLayer } from '../../../shared/project.ts';
import { moveCaptions } from '../project/captions.ts';
import { projectStore } from '../project/store.ts';
import { pauseClip } from './playback.ts';

/**
 * The band of the preview the captions sit in, over the framing overlay:
 * dragging it moves the captions up or down. Dragging anywhere else still
 * moves the picture.
 */
export function CaptionOverlay({ clipId, layer, time }: { clipId: string; layer: CaptionLayer; time: number }) {
  const { t } = useTranslation();
  const drag = useRef<{ startY: number; from: number; height: number } | null>(null);
  const y = valueAt(layer.y, time);
  const box = captionBox(layer.style, y, OUTPUT.height);
  const pct = (px: number) => `${(px / OUTPUT.height) * 100}%`;

  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    projectStore.getState().endGesture();
  };

  return (
    <div
      className="caption-overlay"
      role="slider"
      aria-label={t('captions.drag')}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={y}
      title={t('captions.drag')}
      style={{ top: pct(box.top), height: pct(box.bottom - box.top) }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        pauseClip();
        e.currentTarget.setPointerCapture(e.pointerId);
        // The preview's height on screen turns pointer pixels into output fractions.
        const height = e.currentTarget.parentElement!.getBoundingClientRect().height;
        drag.current = { startY: e.clientY, from: y, height };
        projectStore.getState().beginGesture('history.moveCaptions');
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) moveCaptions(clipId, time, d.from + (e.clientY - d.startY) / d.height);
      }}
      onPointerUp={end}
      onLostPointerCapture={end}
    />
  );
}
