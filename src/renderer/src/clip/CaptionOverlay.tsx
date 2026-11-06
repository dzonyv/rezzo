import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { captionBox, type CaptionTrack } from '../../../shared/captions.ts';
import { OUTPUT, valueAt } from '../../../shared/framing.ts';
import type { CaptionLayer } from '../../../shared/project.ts';
import { moveCaptions } from '../project/captions.ts';
import { projectStore } from '../project/store.ts';
import { pauseClip } from './playback.ts';
import { selectLayer } from './state.ts';

/**
 * The band of the preview the captions sit in, over the framing overlay:
 * dragging it moves the captions up or down. Dragging anywhere else still
 * moves the picture, and the wheel zooms it here too.
 */
export function CaptionOverlay({ clipId, layer, track, time }: { clipId: string; layer: CaptionLayer; track: CaptionTrack; time: number }) {
  const { t } = useTranslation();
  const el = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; from: number; height: number } | null>(null);

  // The band covers part of the framing overlay; the wheel goes on to it, so
  // zooming works over the captions as it does everywhere else in the preview.
  useEffect(() => {
    const node = el.current!;
    const forward = (e: WheelEvent) => {
      const framing = node.parentElement?.querySelector('.framing-overlay');
      if (!framing) return;
      e.preventDefault();
      framing.dispatchEvent(new WheelEvent('wheel', e));
    };
    node.addEventListener('wheel', forward, { passive: false });
    return () => node.removeEventListener('wheel', forward);
  }, []);
  const y = valueAt(layer[track], time);
  const box = captionBox(layer.style, y, OUTPUT.height);
  const pct = (px: number) => `${(px / OUTPUT.height) * 100}%`;

  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    projectStore.getState().endGesture();
  };

  return (
    <div
      ref={el}
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
        selectLayer(null);
        e.currentTarget.setPointerCapture(e.pointerId);
        // The preview's height on screen turns pointer pixels into output fractions.
        const height = e.currentTarget.parentElement!.getBoundingClientRect().height;
        drag.current = { startY: e.clientY, from: y, height };
        projectStore.getState().beginGesture('history.moveCaptions');
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) moveCaptions(clipId, track, time, d.from + (e.clientY - d.startY) / d.height);
      }}
      onPointerUp={end}
      onLostPointerCapture={end}
    />
  );
}
