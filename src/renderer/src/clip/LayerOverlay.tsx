import { useEffect, useEffectEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Asset } from '../../../shared/assets.ts';
import { OUTPUT, valueAt } from '../../../shared/framing.ts';
import { layerTransformAt, MAX_LAYER_SCALE, MIN_LAYER_SCALE, type Transform } from '../../../shared/motion.ts';
import { isTimed, timedLayers, type Clip, type TimedLayer } from '../../../shared/project.ts';
import { quadOf, showsAt } from '../../../shared/scene.ts';
import { setChromaKey, setTransform } from '../project/layers.ts';
import { projectStore } from '../project/store.ts';
import { sampleColor, stopPicking, usePicking } from './eyedropper.ts';
import { outputPoint } from './output-point.ts';
import { pauseClip } from './playback.ts';
import { selectLayer } from './state.ts';

/** Moving a layer's centre snaps to the middle of the output this close, in output pixels. */
const SNAP_PX = 14;
/** Turning snaps to a quarter turn this close, in degrees. */
const SNAP_DEGREES = 4;
/** How long the wheel has to rest before a resize becomes its own undo step. */
const WHEEL_GESTURE_MS = 400;

type Grab = 'move' | 'resize' | 'rotate';
const CORNERS = ['tl', 'tr', 'br', 'bl'] as const;

interface Drag {
  grab: Grab;
  layerId: string;
  /** Pointer at the start, in output pixels. */
  x: number;
  y: number;
  /** The layer's own transform (without animations) when the drag started. */
  from: Transform;
  /** Where its centre is drawn, in output pixels. */
  cx: number;
  cy: number;
}

interface Props {
  clip: Clip;
  assets: readonly Asset[];
  selectedId: string | null;
  /** Source seconds of the frame on screen; edits land there. */
  time: number;
}

const snapTo = (value: number, target: number, reach: number, off: boolean) => (!off && Math.abs(value - target) <= reach ? target : value);

/** The layer's transform without animations at `time`, as it is in the document right now. */
function ownTransform(clipId: string, layerId: string, time: number): Transform | null {
  const layer = projectStore.getState().project?.clips.find((c) => c.id === clipId)?.layers.find((l) => l.id === layerId);
  return layer && isTimed(layer) ? valueAt(layer.transform, time) : null;
}

/**
 * Boxes over the preview for the layers showing now. Pressing one selects
 * it; dragging moves it, its corners resize it and the round handle turns
 * it. The wheel resizes it too. Where no layer is, the framing overlay
 * underneath gets the pointer as before.
 */
export function LayerOverlay({ clip, assets, selectedId, time }: Props) {
  const { t } = useTranslation();
  const el = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const wheel = useRef({ timer: 0, layerId: '' });

  const shown = timedLayers(clip).filter((l) => showsAt(l, time));
  const picking = usePicking();
  const assetOf = (layer: TimedLayer) => assets.find((a) => a.id === layer.assetId);

  const toOutput = (clientX: number, clientY: number) => outputPoint(el.current!, clientX, clientY);

  const begin = (e: React.PointerEvent, layer: TimedLayer, grab: Grab) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pauseClip();
    selectLayer(layer.id);
    const from = ownTransform(clip.id, layer.id, time);
    const asset = assetOf(layer);
    if (!from || !asset) return;
    const drawn = quadOf(layerTransformAt(layer, time), asset);
    // Moves then come to the box or handle, and bubble up to the overlay.
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current ={ grab, layerId: layer.id, ...toOutput(e.clientX, e.clientY), from, cx: drawn.cx, cy: drawn.cy };
    projectStore.getState().beginGesture('history.placeLayer');
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toOutput(e.clientX, e.clientY);
    const free = e.shiftKey;
    if (d.grab === 'move') {
      const x = d.from.x + (p.x - d.x) / OUTPUT.width;
      const y = d.from.y + (p.y - d.y) / OUTPUT.height;
      setTransform(clip.id, d.layerId, time, {
        x: snapTo(x, 0.5, SNAP_PX / OUTPUT.width, free),
        y: snapTo(y, 0.5, SNAP_PX / OUTPUT.height, free),
      });
    } else if (d.grab === 'resize') {
      const before = Math.hypot(d.x - d.cx, d.y - d.cy);
      const now = Math.hypot(p.x - d.cx, p.y - d.cy);
      if (before < 1) return;
      setTransform(clip.id, d.layerId, time, { scale: Math.min(MAX_LAYER_SCALE, Math.max(MIN_LAYER_SCALE, (d.from.scale * now) / before)) });
    } else {
      const turn = ((Math.atan2(p.y - d.cy, p.x - d.cx) - Math.atan2(d.y - d.cy, d.x - d.cx)) * 180) / Math.PI;
      let rotation = d.from.rotation + turn;
      rotation = ((((rotation + 180) % 360) + 360) % 360) - 180;
      for (const quarter of [-180, -90, 0, 90, 180]) rotation = snapTo(rotation, quarter, SNAP_DEGREES, free);
      setTransform(clip.id, d.layerId, time, { rotation });
    }
  };

  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    projectStore.getState().endGesture();
  };

  // The wheel over a layer resizes it.
  const onWheel = useEffectEvent((e: WheelEvent) => {
    const layerId = (e.target as HTMLElement).closest<HTMLElement>('[data-layer]')?.dataset['layer'];
    if (!layerId) return;
    e.preventDefault();
    const from = ownTransform(clip.id, layerId, time);
    if (!from) return;
    const w = wheel.current;
    if (!w.timer || w.layerId !== layerId) projectStore.getState().beginGesture('history.placeLayer');
    clearTimeout(w.timer);
    w.layerId = layerId;
    w.timer = window.setTimeout(() => {
      w.timer = 0;
      projectStore.getState().endGesture();
    }, WHEEL_GESTURE_MS);
    const scale = Math.min(MAX_LAYER_SCALE, Math.max(MIN_LAYER_SCALE, from.scale * Math.exp(-e.deltaY * 0.0015)));
    setTransform(clip.id, layerId, time, { scale });
  });
  // React's wheel listener is passive; this one needs to stop the page from scrolling.
  useEffect(() => {
    const node = el.current!;
    const listener = (e: WheelEvent) => onWheel(e);
    node.addEventListener('wheel', listener, { passive: false });
    return () => node.removeEventListener('wheel', listener);
  }, []);

  /** Picking a key colour: a click on the layer takes its colour there; anywhere else, or Escape, stops. */
  const pick = (e: React.PointerEvent) => {
    if (!picking) return;
    e.stopPropagation();
    e.preventDefault();
    const layer = shown.find((l) => l.id === picking);
    const asset = layer && assetOf(layer);
    if (layer && asset) {
      const q = quadOf(layerTransformAt(layer, time), asset);
      const p = toOutput(e.clientX, e.clientY);
      // Into the layer's own axes: undo its turn about its centre.
      const cos = Math.cos(-q.rotation);
      const sin = Math.sin(-q.rotation);
      const dx = p.x - q.cx;
      const dy = p.y - q.cy;
      const u = (dx * cos - dy * sin) / q.w + 0.5;
      const v = (dx * sin + dy * cos) / q.h + 0.5;
      const color = u >= 0 && u <= 1 && v >= 0 && v <= 1 ? sampleColor(layer.id, asset.id, u, v) : null;
      if (color) setChromaKey(clip.id, layer.id, { color });
    }
    stopPicking();
  };
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      stopPicking();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [picking]);

  const pctX = (px: number) => `${(px / OUTPUT.width) * 100}%`;
  const pctY = (px: number) => `${(px / OUTPUT.height) * 100}%`;

  return (
    <div ref={el} className={`layer-overlay${picking ? ' picking' : ''}`} onPointerDownCapture={pick} onPointerMove={onMove} onPointerUp={end} onLostPointerCapture={end}>
      {shown.map((layer) => {
        const asset = assetOf(layer);
        if (!asset) return null;
        const q = quadOf(layerTransformAt(layer, time), asset);
        const selected = layer.id === selectedId;
        return (
          <div
            key={layer.id}
            data-layer={layer.id}
            className={`layer-box${selected ? ' selected' : ''}`}
            role="button"
            aria-label={t('layers.select', { name: asset.name })}
            title={asset.name}
            style={{ left: pctX(q.cx), top: pctY(q.cy), width: pctX(q.w), height: pctY(q.h), transform: `translate(-50%, -50%) rotate(${q.rotation}rad)` }}
            onPointerDown={(e) => begin(e, layer, 'move')}
          >
            {selected && (
              <>
                {CORNERS.map((corner) => (
                  <div key={corner} className={`handle ${corner}`} role="button" aria-label={t('layers.resize')} title={t('layers.resize')} onPointerDown={(e) => begin(e, layer, 'resize')} />
                ))}
                <div className="handle rotate" role="button" aria-label={t('layers.rotate')} title={t('layers.rotate')} onPointerDown={(e) => begin(e, layer, 'rotate')} />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
