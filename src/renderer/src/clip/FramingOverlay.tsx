import { useEffect, useEffectEvent, useRef } from 'react';
import { MAX_ZOOM, videoLayerOf, type Crop, type FullFrame, type Layout } from '../../../shared/project.ts';
import { OUTPUT, panCrop, panFull, regions, valueAt, zoomCrop, type Rect, type Size } from '../../../shared/framing.ts';
import { setFraming, type FramingProperty } from '../project/framing.ts';
import { projectStore } from '../project/store.ts';
import { pauseClip } from './playback.ts';

/** How long the wheel has to rest before a zoom becomes its own undo step. */
const WHEEL_GESTURE_MS = 400;

interface Props {
  clipId: string;
  layout: Layout;
  /** Which half of Split the user is working on. */
  half: 'top' | 'bottom';
  onHalf: (half: 'top' | 'bottom') => void;
  /** Source seconds of the frame on screen; edits land there. */
  time: number;
  sourceSize: Size | null;
}

export const propertyFor = (layout: Layout, half: 'top' | 'bottom'): FramingProperty =>
  layout === 'follow' ? 'follow' : layout === 'full' ? 'full' : half === 'top' ? 'splitTop' : 'splitBottom';

/** The output area a property fills. */
export const regionFor = (layout: Layout, half: 'top' | 'bottom'): Rect =>
  regions(layout)[layout === 'split' && half === 'bottom' ? 1 : 0]!;

/** The value as it is in the document right now, mid-gesture included. */
function currentValue(clipId: string, property: FramingProperty, time: number): Crop | FullFrame | null {
  const clip = projectStore.getState().project?.clips.find((c) => c.id === clipId);
  return clip ? valueAt(videoLayerOf(clip)[property], time) : null;
}

/** Zooms the value for `property` to `zoom`, around (px, py) in output pixels. */
export function zoomed(value: Crop | FullFrame, property: FramingProperty, region: Rect, size: Size, zoom: number, px: number, py: number): Crop | FullFrame {
  const z = Math.min(MAX_ZOOM, Math.max(1, zoom));
  if (property === 'full') return { ...(value as FullFrame), zoom: z };
  return zoomCrop(value as Crop, region, size, z, px, py);
}

/**
 * Sits over the preview and turns pointer drags into framing: drag to move
 * the picture, scroll to zoom. In Split the half under the pointer is the
 * one that moves.
 */
export function FramingOverlay({ clipId, layout, half, onHalf, time, sourceSize }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const drag = useRef<{ property: FramingProperty; region: Rect; x: number; y: number } | null>(null);

  /** Pointer position in output pixels. */
  const toOutput = (clientX: number, clientY: number) => {
    const box = el.current!.getBoundingClientRect();
    return { x: ((clientX - box.left) / box.width) * OUTPUT.width, y: ((clientY - box.top) / box.height) * OUTPUT.height };
  };
  const halfAt = (y: number): 'top' | 'bottom' => (y < OUTPUT.height / 2 ? 'top' : 'bottom');

  const wheelTimer = useRef(0);
  const onWheel = useEffectEvent((e: WheelEvent) => {
    if (!sourceSize) return;
    e.preventDefault();
    const p = toOutput(e.clientX, e.clientY);
    const h = layout === 'split' ? halfAt(p.y) : half;
    if (h !== half) onHalf(h);
    const property = propertyFor(layout, h);
    const value = currentValue(clipId, property, time);
    if (!value) return;
    const store = projectStore.getState();
    if (!wheelTimer.current) store.beginGesture('history.zoomFrame');
    clearTimeout(wheelTimer.current);
    wheelTimer.current = window.setTimeout(() => {
      wheelTimer.current = 0;
      projectStore.getState().endGesture();
    }, WHEEL_GESTURE_MS);
    const next = zoomed(value, property, regionFor(layout, h), sourceSize, value.zoom * Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    setFraming(clipId, 'history.zoomFrame', property, time, next);
  });
  // React's wheel listener is passive; this one needs to stop the page from scrolling.
  useEffect(() => {
    const node = el.current!;
    const listener = (e: WheelEvent) => onWheel(e);
    node.addEventListener('wheel', listener, { passive: false });
    return () => node.removeEventListener('wheel', listener);
  }, []);

  return (
    <div
      ref={el}
      className={`framing-overlay layout-${layout}`}
      onPointerDown={(e) => {
        if (!sourceSize || e.button !== 0) return;
        pauseClip();
        const p = toOutput(e.clientX, e.clientY);
        const h = layout === 'split' ? halfAt(p.y) : half;
        if (h !== half) onHalf(h);
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { property: propertyFor(layout, h), region: regionFor(layout, h), ...p };
        projectStore.getState().beginGesture('history.moveFrame');
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || !sourceSize) return;
        const p = toOutput(e.clientX, e.clientY);
        const value = currentValue(clipId, d.property, time);
        if (!value) return;
        const next =
          d.property === 'full'
            ? panFull(value as FullFrame, sourceSize, p.y - d.y)
            : panCrop(value as Crop, d.region, sourceSize, p.x - d.x, p.y - d.y);
        setFraming(clipId, 'history.moveFrame', d.property, time, next);
        drag.current = { ...d, ...p };
      }}
      onPointerUp={() => {
        if (!drag.current) return;
        drag.current = null;
        projectStore.getState().endGesture();
      }}
      onPointerCancel={() => {
        drag.current = null;
        projectStore.getState().endGesture();
      }}
    >
      {layout === 'split' && <div className={`split-half ${half}`} />}
    </div>
  );
}
