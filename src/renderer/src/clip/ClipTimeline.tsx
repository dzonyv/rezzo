import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Asset } from '../../../shared/assets.ts';
import type { CaptionPage } from '../../../shared/captions.ts';
import { EFFECTS } from '../../../shared/effects.ts';
import { ASSET_KIND_OF, isTimed, keyframesOf, videoLayerOf, type Animated, type Clip, type TimedLayer } from '../../../shared/project.ts';
import { moveLayer, reorderLayer, trimLayer } from '../project/layers.ts';
import { videoLayersOverLimit } from '../../../shared/overlay-files.ts';
import { projectStore } from '../project/store.ts';
import { useOverlayFile } from '../render/overlay-files.ts';
import { pauseClip, seekClip } from './playback.ts';
import { selectLayer } from './state.ts';

interface Props {
  clip: Clip;
  assets: readonly Asset[];
  /** Keyframes of the framing being edited, shown on the video row. */
  keys: Animated<unknown>;
  /** The clip's caption pages; empty without captions. */
  pages: readonly CaptionPage[];
  selectedId: string | null;
  time: number;
}

const MAX_ZOOM = 20;
/** A dragged edge snaps to the playhead or another edge this close, in screen pixels. */
const SNAP_PX = 6;

type Drag =
  | { kind: 'scrub' }
  | { kind: 'move' | 'start' | 'end'; layer: TimedLayer; x: number; moved: boolean };

/**
 * The clip from start to end, one row per layer: the layers over the
 * picture (the top row is drawn on top), the captions' pages, and the
 * source video with its layouts (coloured bands) and the keyframes of the
 * framing being edited. Press and drag on empty space to scrub; drag a
 * layer to move it in time and its ends to trim it. Ctrl+scroll zooms.
 */
export function ClipTimeline({ clip, assets, keys, pages, selectedId, time }: Props) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [zoom, setZoom] = useState(1);
  const length = clip.end - clip.start;
  const pct = (seconds: number) => ((Math.min(Math.max(seconds, clip.start), clip.end) - clip.start) / length) * 100;
  const at = (seconds: number) => `${pct(seconds)}%`;
  const span = (from: number, to: number) => ({ left: at(from), width: `${pct(to) - pct(from)}%` });

  /** Source seconds under a pointer position. */
  const timeAt = (clientX: number) => {
    const box = track.current!.getBoundingClientRect();
    return clip.start + Math.min(Math.max((clientX - box.left) / box.width, 0), 1) * length;
  };
  /** Seconds that one screen pixel covers. */
  const perPixel = () => length / track.current!.getBoundingClientRect().width;

  const layout = videoLayerOf(clip).layout;
  const bands = layout.map((k, i) => ({ from: Math.max(k.t, clip.start), to: layout[i + 1]?.t ?? clip.end, layout: k.value }));
  // Top row first: the layer drawn last.
  const rows = clip.layers.slice(1).reverse();
  const raise = (id: string) => reorderLayer(clip.id, id, 'up');
  const lower = (id: string) => reorderLayer(clip.id, id, 'down');
  const overLimit = videoLayersOverLimit(clip);
  const nameOf = (layer: TimedLayer) =>
    layer.kind === 'effect' ? t(`effects.names.${layer.effect}`) : (assets.find((a) => a.id === layer.assetId)?.name ?? t(`layers.kinds.${ASSET_KIND_OF[layer.kind]}`));
  /** Effects' bars have their group's colour. */
  const barClass = (layer: TimedLayer) => (layer.kind === 'effect' ? `effect ${EFFECTS[layer.effect].group}` : layer.kind);

  /** Diamonds for keyframes inside the clip; pressing one goes to it. */
  const keyMarks = (marks: Animated<unknown>) =>
    marks
      .filter((k) => k.t >= clip.start && k.t <= clip.end)
      .map((k) => (
        <button
          key={k.t}
          type="button"
          className="key"
          style={{ left: at(k.t) }}
          aria-label={t('clipEditor.goToKeyframe')}
          title={t('clipEditor.goToKeyframe')}
          onPointerDown={(e) => {
            e.stopPropagation();
            seekClip(k.t);
          }}
        />
      ));

  /** Where an edge at `seconds` snaps to: the playhead, the clip's ends or another layer's ends. */
  const snap = (seconds: number, self: string) => {
    const targets = [time, clip.start, clip.end, ...clip.layers.filter((l) => isTimed(l) && l.id !== self).flatMap((l) => (isTimed(l) ? [l.start, l.end] : []))];
    const reach = SNAP_PX * perPixel();
    let best: number | null = null;
    for (const target of targets) if (Math.abs(target - seconds) <= reach && (best === null || Math.abs(target - seconds) < Math.abs(best - seconds))) best = target;
    return best;
  };

  // Ctrl+wheel zooms around the pointer; React's wheel listener is passive, so this one is added by hand.
  useEffect(() => {
    const node = scroller.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const box = node.getBoundingClientRect();
      const x = e.clientX - box.left;
      const f = (node.scrollLeft + x) / node.scrollWidth;
      setZoom((z) => {
        const next = Math.min(MAX_ZOOM, Math.max(1, z * Math.exp(-e.deltaY * 0.002)));
        // Keep the moment under the pointer where it is once the new width is laid out.
        requestAnimationFrame(() => (node.scrollLeft = f * node.scrollWidth - x));
        return next;
      });
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  const startLayerDrag = (e: React.PointerEvent, layer: TimedLayer, kind: 'move' | 'start' | 'end') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pauseClip();
    selectLayer(layer.id);
    track.current!.setPointerCapture(e.pointerId);
    drag.current = { kind, layer, x: e.clientX, moved: false };
    projectStore.getState().beginGesture(kind === 'move' ? 'history.moveLayer' : 'history.trimLayer');
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !track.current!.hasPointerCapture(e.pointerId)) return;
    if (d.kind === 'scrub') {
      seekClip(timeAt(e.clientX));
      return;
    }
    const shift = (e.clientX - d.x) * perPixel();
    if (!d.moved && Math.abs(e.clientX - d.x) < 2) return;
    d.moved = true;
    const { layer } = d;
    if (d.kind === 'move') {
      let start = layer.start + shift;
      const end = start + (layer.end - layer.start);
      const toStart = snap(start, layer.id);
      const toEnd = snap(end, layer.id);
      if (toStart !== null) start = toStart;
      else if (toEnd !== null) start = toEnd - (layer.end - layer.start);
      moveLayer(clip.id, layer.id, start);
    } else {
      const edge = d.kind === 'start' ? layer.start + shift : layer.end + shift;
      trimLayer(clip.id, layer.id, d.kind, snap(edge, layer.id) ?? edge);
    }
  };

  const onEnd = () => {
    const d = drag.current;
    drag.current = null;
    if (d && d.kind !== 'scrub') projectStore.getState().endGesture();
  };

  return (
    <div className="clip-timeline-box">
      <div className="timeline-labels" aria-label={t('layers.rows')}>
        {rows.map((layer, i) => (
          <div key={layer.id} className={`timeline-label${layer.id === selectedId ? ' selected' : ''}`}>
            <button
              type="button"
              className="name"
              title={t('layers.select', { name: isTimed(layer) ? nameOf(layer) : t('layers.captions') })}
              onClick={() => selectLayer(isTimed(layer) ? layer.id : null)}
            >
              {isTimed(layer) ? nameOf(layer) : t('layers.captions')}
            </button>
            <button type="button" className="icon" disabled={i === 0} aria-label={t('layers.up')} title={t('layers.up')} onClick={() => raise(layer.id)}>
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M2 6.5l3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </button>
            <button type="button" className="icon" disabled={i === rows.length - 1} aria-label={t('layers.down')} title={t('layers.down')} onClick={() => lower(layer.id)}>
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </button>
          </div>
        ))}
        <div className={`timeline-label video${selectedId === null ? ' selected' : ''}`}>
          <button type="button" className="name" onClick={() => selectLayer(null)}>
            {t('layers.video')}
          </button>
        </div>
      </div>

      <div ref={scroller} className="timeline-scroll" title={t('layers.zoomHelp')}>
        <div
          ref={track}
          className="clip-timeline"
          style={{ width: `${zoom * 100}%` }}
          role="slider"
          aria-label={t('clipEditor.timeline')}
          aria-valuemin={0}
          aria-valuemax={length}
          aria-valuenow={time - clip.start}
          tabIndex={-1}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { kind: 'scrub' };
            seekClip(timeAt(e.clientX));
          }}
          onPointerMove={onMove}
          onPointerUp={onEnd}
          onLostPointerCapture={onEnd}
        >
          {rows.map((layer) =>
            isTimed(layer) ? (
              <div key={layer.id} className="timeline-row">
                <div
                  className={`layer-bar ${barClass(layer)}${layer.id === selectedId ? ' selected' : ''}${overLimit.has(layer.id) ? ' over-limit' : ''}`}
                  style={span(layer.start, layer.end)}
                  role="button"
                  aria-label={t('layers.moveBar', { name: nameOf(layer) })}
                  title={nameOf(layer)}
                  onPointerDown={(e) => startLayerDrag(e, layer, 'move')}
                >
                  {layer.kind === 'overlay' && <OverlayProgress layerId={layer.id} />}
                  <span className="layer-name">{nameOf(layer)}</span>
                  <div className="edge start" role="separator" aria-label={t('layers.startHandle', { name: nameOf(layer) })} onPointerDown={(e) => startLayerDrag(e, layer, 'start')} />
                  <div className="edge end" role="separator" aria-label={t('layers.endHandle', { name: nameOf(layer) })} onPointerDown={(e) => startLayerDrag(e, layer, 'end')} />
                </div>
                {layer.id === selectedId && keyframesOf(layer).length > 1 && keyMarks(keyframesOf(layer))}
              </div>
            ) : (
              <div key={layer.id} className="timeline-row captions">
                <div className="caption-pages" aria-label={t('captions.pages')}>
                  {pages.map((p) => (
                    <div key={p.start} className="page" style={span(p.start, p.end)} title={p.words.map((w) => w.text).join(' ')} />
                  ))}
                </div>
              </div>
            ),
          )}

          <div className="timeline-row video">
            {bands
              .filter((b) => b.to > clip.start && b.from < clip.end)
              .map((b) => (
                <div key={b.from} className={`band ${b.layout}`} style={span(b.from, b.to)} title={t(`clipEditor.layouts.${b.layout}`)} />
              ))}
            {keyMarks(keys)}
          </div>
          <div className="playhead" style={{ left: at(time) }} />
        </div>
      </div>
    </div>
  );
}

/** How far a video layer's working file is, filling its bar from the left; nothing once it's ready. */
function OverlayProgress({ layerId }: { layerId: string }) {
  const { t } = useTranslation();
  const state = useOverlayFile(layerId);
  if (state?.status === 'preparing') {
    return <div className="layer-progress" role="progressbar" aria-label={t('layers.preparing')} aria-valuenow={Math.round(state.progress * 100)} style={{ width: `${state.progress * 100}%` }} />;
  }
  if (state?.status === 'failed') return <div className="layer-progress failed" title={t('layers.errors.prepare', { detail: state.detail })} />;
  return null;
}
