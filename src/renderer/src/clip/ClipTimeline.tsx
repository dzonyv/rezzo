import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Asset } from '../../../shared/assets.ts';
import type { CaptionPage } from '../../../shared/captions.ts';
import { EFFECTS } from '../../../shared/effects.ts';
import { isTimed, keyframesOf, videoLayerOf, type Animated, type Clip, type TimedLayer } from '../../../shared/project.ts';
import { outputTime } from '../../../shared/skips.ts';
import { moveLayer, reorderLayer, trimLayer } from '../project/layers.ts';
import { restoreSkip } from '../project/skips.ts';
import { videoLayersOverLimit } from '../../../shared/overlay-files.ts';
import { projectStore, useProject } from '../project/store.ts';
import type { VoiceTurn } from '../../../shared/voices.ts';
import { useAnalysis } from '../analysis/store.ts';
import { formatClipTime } from '../format.ts';
import { useHeardVoices } from '../project/voices.ts';
import { useOverlayFile } from '../render/overlay-files.ts';
import { voiceColor, voiceLabel } from '../voice-colors.ts';
import { pauseClip, seekClip } from './playback.ts';
import { layerName, rowsOf } from './layer-names.ts';
import { useStretches } from './speakers.ts';
import { selectLayer, toggleFoundPause, useFoundPauses } from './state.ts';
import { VoiceTurnMenu } from './VoiceTurnMenu.tsx';

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
/** One press of the zoom buttons. */
const ZOOM_STEP = 1.5;
/** A dragged edge snaps to the playhead or another edge this close, in screen pixels. */
const SNAP_PX = 6;
/** Ruler steps in seconds; the smallest that leaves this much room between labels is used. */
const RULER_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
const RULER_GAP_PX = 64;

type Drag =
  | { kind: 'scrub' }
  | { kind: 'move' | 'start' | 'end'; layer: TimedLayer; x: number; moved: boolean };

/** The part of the clip in view, as fractions of its length. */
interface View {
  from: number;
  to: number;
}

const viewOf = (node: HTMLElement): View =>
  node.scrollWidth === 0 ? { from: 0, to: 1 } : { from: node.scrollLeft / node.scrollWidth, to: (node.scrollLeft + node.clientWidth) / node.scrollWidth };

/** Dragging the box on the overview: moving it, or one of its edges (which zooms). */
interface OverviewDrag {
  kind: 'pan' | 'from' | 'to';
  x: number;
  view: View;
}

/**
 * The clip from start to end, one row per layer: the layers over the
 * picture (the top row is drawn on top), the captions' pages, and the
 * source video with its layouts (coloured bands) and the keyframes of the
 * framing being edited, with the camera cuts the analysis found. Below it,
 * who talks when (the episode's voices), where the user said who it is, and
 * where nobody knows yet. Each row's name stays at its left edge as the
 * timeline scrolls; the pointer goes through it to what's underneath.
 * Press a layer to select it, and the video row to select the picture.
 *
 * Above the rows, a ruler in the clip's own time (what plays, without the
 * cut parts) and the playhead's time. Above that, the whole clip in small
 * with a box around the part in view: drag the box to move along the clip
 * and its edges to zoom. Ctrl+scroll zooms too.
 *
 * Press and drag on empty space to scrub; drag a layer to move it in time
 * and its ends to trim it. Right-click a turn to correct it.
 */
export function ClipTimeline({ clip, assets, keys, pages, selectedId, time }: Props) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const overview = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const overviewDrag = useRef<OverviewDrag | null>(null);
  /** Where to scroll once a new zoom is laid out: keep `fraction` of the clip `x` pixels into the view. */
  const anchor = useRef<{ fraction: number; x: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewWidth, setViewWidth] = useState(0);
  const [turnMenu, setTurnMenu] = useState<{ turn: VoiceTurn; at: number; x: number; y: number } | null>(null);
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

  const found = useFoundPauses(clip.id) ?? [];
  const shots = useAnalysis((s) => s.analysis?.shots);
  const heard = useHeardVoices();
  const turns = heard?.turns;
  const picks = useProject((s) => s.project?.voices.picks) ?? [];
  const stretches = useStretches();
  const cuts = (shots ?? []).slice(1).map((s) => s.start).filter((c) => c > clip.start && c < clip.end);
  const inClip = (from: number, to: number) => to > clip.start && from < clip.end;
  const clipTurns = (turns ?? []).filter((v) => inClip(v.start, v.end));
  const skips = clip.skips.filter((s) => inClip(s.start, s.end));
  const labelOf = (voice: number) => voiceLabel(t, heard?.voices.find((v) => v.id === voice) ?? { id: voice, name: null });

  const layout = videoLayerOf(clip).layout;
  const bands = layout
    .map((k, i) => ({ from: Math.max(k.t, clip.start), to: layout[i + 1]?.t ?? clip.end, layout: k.value }))
    .filter((b) => b.to > clip.start && b.from < clip.end);
  const rows = rowsOf(clip);
  const overLimit = videoLayersOverLimit(clip);
  const nameOf = (layer: TimedLayer) => layerName(t, layer, assets);
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

  /** The ruler needs the view's width; the part in view is read when needed, not kept, so scrolling doesn't redraw the rows. */
  const readWidth = () => {
    const node = scroller.current;
    if (node) setViewWidth(node.clientWidth);
  };

  /** Zooms so that `fraction` of the clip ends up `x` pixels into the view. */
  const zoomTo = (next: number, fraction: number, x: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(1, next));
    if (clamped === zoom) {
      // No new layout to wait for.
      const node = scroller.current!;
      node.scrollLeft = fraction * node.scrollWidth - x;
      return;
    }
    anchor.current = { fraction, x };
    setZoom(clamped);
  };

  /** Zooms around the middle of the view (the zoom buttons). */
  const zoomBy = (factor: number) => {
    const node = scroller.current!;
    const view = viewOf(node);
    zoomTo(zoom * factor, (view.from + view.to) / 2, node.clientWidth / 2);
  };

  /** Shows the part of the clip from `from` to `to` (fractions). */
  const showPart = (from: number, to: number) => zoomTo(1 / (to - from), from, 0);

  // Once a new zoom is laid out, scroll to where zoomTo() wanted it.
  useLayoutEffect(() => {
    const node = scroller.current!;
    if (anchor.current) {
      node.scrollLeft = anchor.current.fraction * node.scrollWidth - anchor.current.x;
      anchor.current = null;
    }
  }, [zoom]);

  useEffect(() => {
    const node = scroller.current!;
    const resize = new ResizeObserver(readWidth);
    resize.observe(node);
    return () => resize.disconnect();
  }, []);

  // Ctrl+wheel zooms around the pointer; React's wheel listener is passive, so this one is added by hand.
  useEffect(() => {
    const node = scroller.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const x = e.clientX - node.getBoundingClientRect().left;
      const fraction = (node.scrollLeft + x) / node.scrollWidth;
      setZoom((z) => {
        anchor.current = { fraction, x };
        return Math.min(MAX_ZOOM, Math.max(1, z * Math.exp(-e.deltaY * 0.002)));
      });
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  // A playhead that leaves the view (playing, or stepping with the arrow keys) brings the view along.
  useEffect(() => {
    const node = scroller.current;
    if (!node || zoom === 1 || drag.current || overviewDrag.current) return;
    const fraction = (time - clip.start) / length;
    const from = node.scrollLeft / node.scrollWidth;
    const to = (node.scrollLeft + node.clientWidth) / node.scrollWidth;
    if (fraction < from || fraction > to) node.scrollLeft = fraction * node.scrollWidth - node.clientWidth * 0.1;
    // Only when the playhead moves: moving the view by hand mustn't pull it back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time]);

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

  const startOverviewDrag = (e: React.PointerEvent, kind: OverviewDrag['kind']) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    overview.current!.setPointerCapture(e.pointerId);
    let current = viewOf(scroller.current!);
    if (kind === 'pan' && e.currentTarget === overview.current) {
      // Pressed beside the box: the box jumps there first, centred on the pointer.
      const box = overview.current.getBoundingClientRect();
      const width = current.to - current.from;
      const from = Math.min(Math.max((e.clientX - box.left) / box.width - width / 2, 0), 1 - width);
      current = { from, to: from + width };
      scroller.current!.scrollLeft = from * scroller.current!.scrollWidth;
    }
    overviewDrag.current = { kind, x: e.clientX, view: current };
  };

  const onOverviewMove = (e: React.PointerEvent) => {
    const d = overviewDrag.current;
    if (!d || !overview.current!.hasPointerCapture(e.pointerId)) return;
    const shift = (e.clientX - d.x) / overview.current!.getBoundingClientRect().width;
    const smallest = 1 / MAX_ZOOM;
    if (d.kind === 'pan') {
      const width = d.view.to - d.view.from;
      const from = Math.min(Math.max(d.view.from + shift, 0), 1 - width);
      scroller.current!.scrollLeft = from * scroller.current!.scrollWidth;
    } else if (d.kind === 'from') {
      showPart(Math.min(Math.max(d.view.from + shift, 0), d.view.to - smallest), d.view.to);
    } else {
      showPart(d.view.from, Math.max(Math.min(d.view.to + shift, 1), d.view.from + smallest));
    }
  };

  // The ruler's ticks, in the clip's own time.
  const trackWidth = viewWidth * zoom;
  const step = RULER_STEPS.find((s) => (s / length) * trackWidth >= RULER_GAP_PX) ?? RULER_STEPS.at(-1)!;
  const ticks: number[] = [];
  if (trackWidth > 0) for (let s = clip.start; s <= clip.end + 1e-6; s += step) ticks.push(s);
  const inSkip = (s: number) => skips.some((k) => s >= k.start && s < k.end);
  const tickLabel = (s: number) => {
    const out = formatClipTime(outputTime(clip, s));
    // Whole seconds read better without the tenths.
    return step >= 1 ? out.replace(/\.\d$/, '') : out;
  };

  return (
    <div className="clip-timeline-box">
      <div className="timeline-overview-row">
        <div
          ref={overview}
          className="timeline-overview"
          aria-label={t('timeline.overview')}
          title={t('timeline.overviewHelp')}
          onPointerDown={(e) => startOverviewDrag(e, 'pan')}
          onPointerMove={onOverviewMove}
          onPointerUp={() => (overviewDrag.current = null)}
          onLostPointerCapture={() => (overviewDrag.current = null)}
        >
          {bands.map((b) => (
            <div key={b.from} className={`mini band ${b.layout}`} style={span(b.from, b.to)} />
          ))}
          {rows.map((layer, i) =>
            isTimed(layer) ? (
              <div key={layer.id} className={`mini layer ${barClass(layer)}`} style={{ ...span(layer.start, layer.end), top: `${3 + (i % 3) * 5}px` }} />
            ) : null,
          )}
          {skips.map((s) => (
            <div key={s.start} className="mini skip" style={span(s.start, s.end)} />
          ))}
          <div className="mini playhead" style={{ left: at(time) }} />
          <OverviewBox scroller={scroller} zoom={zoom} onPress={startOverviewDrag} />
        </div>
        <div className="timeline-zoom" role="group" aria-label={t('timeline.zoom')}>
          <button type="button" className="icon" disabled={zoom <= 1} aria-label={t('timeline.zoomOut')} title={t('timeline.zoomOut')} onClick={() => zoomBy(1 / ZOOM_STEP)}>
            −
          </button>
          <button type="button" className="icon" disabled={zoom >= MAX_ZOOM} aria-label={t('timeline.zoomIn')} title={t('timeline.zoomIn')} onClick={() => zoomBy(ZOOM_STEP)}>
            +
          </button>
          <button type="button" disabled={zoom === 1} title={t('timeline.wholeHelp')} onClick={() => zoomTo(1, 0, 0)}>
            {t('timeline.whole')}
          </button>
        </div>
      </div>

      <div ref={scroller} id="clip-timeline-scroll" className="timeline-scroll" title={t('layers.zoomHelp')}>
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
            if ((e.target as Element).closest('.timeline-row.video')) selectLayer(null);
            drag.current = { kind: 'scrub' };
            seekClip(timeAt(e.clientX));
          }}
          onPointerMove={onMove}
          onPointerUp={onEnd}
          onLostPointerCapture={onEnd}
        >
          <div className="timeline-ruler" aria-hidden="true">
            {ticks.map((s) => (
              <div key={s} className="tick" style={{ left: at(s) }}>
                {!inSkip(s) && <span>{tickLabel(s)}</span>}
              </div>
            ))}
          </div>

          {rows.map((layer, i) =>
            isTimed(layer) ? (
              <div key={layer.id} className="timeline-row">
                <button
                  type="button"
                  className={`track-tag${layer.id === selectedId ? ' selected' : ''}`}
                  aria-label={t('layers.select', { name: nameOf(layer) })}
                  onClick={() => selectLayer(layer.id)}
                >
                  {nameOf(layer)}
                </button>
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
                <span className="track-tag tools" onPointerDown={(e) => e.stopPropagation()}>
                  <button type="button" className="tag-name" onClick={() => selectLayer(null)}>
                    {t('layers.captions')}
                  </button>
                  {/* Captions aren't selectable on their own, so their order is changed here. */}
                  <button type="button" className="icon" disabled={i === 0} aria-label={t('layers.up')} title={t('layers.up')} onClick={() => reorderLayer(clip.id, layer.id, 'up')}>
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                      <path d="M2 6.5l3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                  </button>
                  <button type="button" className="icon" disabled={i === rows.length - 1} aria-label={t('layers.down')} title={t('layers.down')} onClick={() => reorderLayer(clip.id, layer.id, 'down')}>
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                      <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                  </button>
                </span>
                <div className="caption-pages" aria-label={t('captions.pages')}>
                  {pages.map((p) => (
                    <div key={p.start} className="page" style={span(p.start, p.end)} title={p.words.map((w) => w.text).join(' ')} />
                  ))}
                </div>
              </div>
            ),
          )}

          <div className="timeline-row video">
            <button type="button" className={`track-tag${selectedId === null ? ' selected' : ''}`} onClick={() => selectLayer(null)}>
              {t('layers.video')}
            </button>
            {bands.map((b) => (
              <div key={b.from} className={`band ${b.layout}`} style={span(b.from, b.to)} title={t(`clipEditor.layouts.${b.layout}`)} />
            ))}
            {cuts.map((c) => (
              <div key={c} className="cut" style={{ left: at(c) }} title={t('analysis.cut')} />
            ))}
            <AnalysisProgress />
            {skips.map((s) => (
              <button
                key={s.start}
                type="button"
                className="skip"
                style={span(s.start, s.end)}
                aria-label={t('silence.skipHelp')}
                title={t('silence.skipHelp')}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (e.button === 0) restoreSkip(clip.id, s.start);
                }}
              />
            ))}
            {found.map((p) => (
              <button
                key={p.start}
                type="button"
                className={`found-pause${p.on ? ' on' : ''}`}
                style={span(p.start, p.end)}
                aria-pressed={p.on}
                aria-label={t('silence.pauseHelp')}
                title={t('silence.pauseHelp')}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (e.button === 0) toggleFoundPause(p.start);
                }}
              />
            ))}
            {keyMarks(keys)}
          </div>
          {turns && (
            <div className="timeline-row voices" aria-label={t('voices.title')}>
              <span className="track-tag">{t('voices.title')}</span>
              {clipTurns.map((v) => (
                <div
                  key={v.start}
                  className="voice-turn"
                  style={{ ...span(v.start, v.end), background: voiceColor(v.voice) }}
                  title={t('voices.turnHelp', { voice: labelOf(v.voice) })}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setTurnMenu({ turn: v, at: timeAt(e.clientX), x: e.clientX, y: e.clientY });
                  }}
                />
              ))}
              {stretches
                .filter((s) => s.target.kind === 'group' && inClip(s.start, s.end))
                .map((s) => (
                  <div key={s.start} className="unknown-speaker" style={span(s.start, s.end)} title={t('speakers.why.group')} />
                ))}
              {picks
                .filter((p) => p.t >= clip.start && p.t <= clip.end)
                .map((p) => (
                  <div key={p.t} className="speaker-pick" style={{ left: at(p.t) }} title={t('speakers.picked')} />
                ))}
            </div>
          )}
          {skips.map((s) => (
            <div key={s.start} className="skip-shade" style={span(s.start, s.end)} />
          ))}
          <div className="playhead" style={{ left: at(time) }}>
            <span className="playhead-time">{formatClipTime(outputTime(clip, time))}</span>
          </div>
        </div>
      </div>
      {turnMenu && heard && <VoiceTurnMenu {...turnMenu} voices={heard.voices} onClose={() => setTurnMenu(null)} />}
    </div>
  );
}

/**
 * The box on the overview around the part of the clip in view. It follows
 * the scroller by itself, so scrolling only redraws the box.
 */
function OverviewBox({ scroller, zoom, onPress }: { scroller: React.RefObject<HTMLDivElement | null>; zoom: number; onPress: (e: React.PointerEvent, kind: OverviewDrag['kind']) => void }) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>({ from: 0, to: 1 });
  // Not a layout effect: the scroller comes after this in the page, so its ref is only set once layout effects are done.
  useEffect(() => {
    const node = scroller.current!;
    const read = () => setView((v) => {
      const next = viewOf(node);
      return next.from === v.from && next.to === v.to ? v : next;
    });
    read();
    node.addEventListener('scroll', read, { passive: true });
    const resize = new ResizeObserver(read);
    resize.observe(node);
    return () => {
      node.removeEventListener('scroll', read);
      resize.disconnect();
    };
    // A new zoom changes the width without a scroll event.
  }, [scroller, zoom]);
  return (
    <div
      className="overview-box"
      role="scrollbar"
      aria-orientation="horizontal"
      aria-controls="clip-timeline-scroll"
      aria-label={t('timeline.inView')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(view.from * 100)}
      style={{ left: `${view.from * 100}%`, width: `${(view.to - view.from) * 100}%` }}
      onPointerDown={(e) => onPress(e, 'pan')}
    >
      <div className="overview-edge from" onPointerDown={(e) => onPress(e, 'from')} />
      <div className="overview-edge to" onPointerDown={(e) => onPress(e, 'to')} />
    </div>
  );
}

/** How far the clip analysis is, along the bottom of the video row; its own component so progress only redraws this. */
function AnalysisProgress() {
  const { t } = useTranslation();
  const running = useAnalysis((s) => s.status === 'running');
  const progress = useAnalysis((s) => s.progress);
  if (!running) return null;
  return <div className="analysis-progress" role="progressbar" aria-label={t('analysis.running')} aria-valuenow={Math.round(progress * 100)} style={{ width: `${progress * 100}%` }} />;
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
