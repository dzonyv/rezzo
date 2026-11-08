import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { keyAt, valueAt } from '../../../shared/framing.ts';
import { fps, workingFrameRate } from '../../../shared/frames.ts';
import { videoLayersOverLimit } from '../../../shared/overlay-files.ts';
import { DEFAULT_CLIP_DOCK } from '../../../shared/settings.ts';
import { captionPages, captionTrackFor } from '../../../shared/captions.ts';
import { keptLength, outputTime } from '../../../shared/skips.ts';
import { captionLayerOf, isPlaced, isTimed, LAYOUTS, MAX_ZOOM, videoLayerOf, type Clip, type Source } from '../../../shared/project.ts';
import { exportClip, isExporting, useExport } from '../export/state.ts';
import { formatClipTime } from '../format.ts';
import { nudgeClip, renameClip } from '../project/clips.ts';
import { addKeyframe, deleteKeyframe, setFraming, setLayout, setSmooth } from '../project/framing.ts';
import { deleteLayer, reorderLayer } from '../project/layers.ts';
import { projectStore, useProject } from '../project/store.ts';
import { retimeWord } from '../project/transcript.ts';
import { flatOf, refOf, wordAt } from '../transcript/words.ts';
import { isAvailable } from '../fonts/registry.ts';
import { useSettings } from '../settings.ts';
import { isTypingTarget } from '../ui/focus.ts';
import { EffectLibrary, LayerTiles } from './AddLayers.tsx';
import { AutoFramePanel } from './AutoFramePanel.tsx';
import { ClipDock } from './ClipDock.tsx';
import { SilencePanel } from './SilencePanel.tsx';
import { SoundLibrary } from './SoundLibrary.tsx';
import { SoundPanel } from './SoundPanel.tsx';
import { CaptionOverlay } from './CaptionOverlay.tsx';
import { CaptionPanel } from './CaptionPanel.tsx';
import { ClipPreview } from './ClipPreview.tsx';
import { ClipTimeline } from './ClipTimeline.tsx';
import { FramingOverlay, propertyFor, regionFor, zoomed } from './FramingOverlay.tsx';
import { layerName, rowsOf } from './layer-names.ts';
import { LayerOverlay } from './LayerOverlay.tsx';
import { PeopleOverlay } from './PeopleOverlay.tsx';
import { WhoTalks } from './WhoTalks.tsx';
import { EffectPanel } from './EffectPanel.tsx';
import { LayerPanel } from './LayerPanel.tsx';
import { currentPlayer, seekClip, toggleClip, useClipPlayback } from './playback.ts';
import { clipUiStore, openClip, selectLayer, setTool, useSelectedLayerId, useTool, type ClipTool } from './state.ts';
import { ToolRail } from './ToolRail.tsx';
import { WordStrip } from './WordStrip.tsx';

const EDGES = ['start', 'end'] as const;

/**
 * The open clip, filling the workspace: the 9:16 preview in the middle with
 * play and the layouts under it, the tool rail on the left with the open
 * tool's drawer beside it (framing, captions, layers, effects, pauses, the
 * episode's `voices`, or the transcript, which the workspace puts there),
 * `side` on the right (the clips), and the timeline across the bottom in
 * its dock.
 */
export function ClipEditor({ clip, source, side, voices }: { clip: Clip; source: Source; side: ReactNode; voices: ReactNode }) {
  const { t } = useTranslation();
  const store = projectStore.getState();
  const [half, setHalf] = useState<'top' | 'bottom'>('top');
  const [showPeople, setShowPeople] = useState(false);
  const status = useClipPlayback((s) => s.status);
  const playing = useClipPlayback((s) => s.playing);
  const sourceSize = useClipPlayback((s) => s.sourceSize);
  const playerTime = useClipPlayback((s) => s.time);
  const exporting = useExport(isExporting);
  const transcript = useProject((s) => s.project?.transcript ?? null);
  const assets = useProject((s) => s.project?.assets) ?? [];
  const selectedId = useSelectedLayerId();
  const selected = clip.layers.find((l) => l.id === selectedId);
  const selectedLayer = selected && isTimed(selected) ? selected : null;
  const dock = useSettings((s) => s.clipDock) ?? DEFAULT_CLIP_DOCK;
  const tool = useTool();
  const selectedDrawer = selectedLayer ? (selectedLayer.kind === 'effect' ? 'effects' : selectedLayer.kind === 'sound' ? 'sound' : 'layers') : null;
  useEffect(() => {
    if (selectedDrawer) setTool(selectedDrawer);
  }, [selectedId, selectedDrawer]);

  const rate = workingFrameRate(source);
  const frame = 1 / fps(rate);
  // Until the player is ready, the clip's first frame is "now".
  const time = status === 'ready' ? Math.min(Math.max(playerTime, clip.start), clip.end - frame) : clip.start;
  const layer = videoLayerOf(clip);
  const layout = valueAt(layer.layout, time);
  const property = propertyFor(layout, half);
  const keys = layer[property];
  const keyIndex = keyAt(keys, time, rate);
  const value = valueAt(keys, time);
  const captions = captionLayerOf(clip);
  // Not on every frame of playback: only when the words, the range or the style change.
  const pages = useMemo(
    () => (captions && transcript ? captionPages(flatOf(transcript.segments).words, { start: clip.start, end: clip.end }, captions.style) : []),
    [captions, transcript, clip.start, clip.end],
  );
  /** Trimming moves an edge by about a tenth of a second. */
  const trimStep = Math.max(1, Math.round(fps(rate) / 10));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.ctrlKey) return;
      const player = currentPlayer();
      if (e.altKey) {
        // Alt+arrows: the word starting nearest the playhead starts a frame earlier or later.
        const segments = projectStore.getState().project?.transcript?.segments;
        if (!segments || !player || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
        e.preventDefault();
        const flat = flatOf(segments);
        const now = player.currentTime;
        const heard = wordAt(flat.words, now);
        const after = flat.words[heard + 1];
        const index = after && (heard < 0 || after.start - now < now - flat.words[heard]!.start) ? heard + 1 : heard;
        const word = flat.words[index];
        if (!word) return;
        retimeWord(refOf(flat, index), word.start + frame * (e.key === 'ArrowLeft' ? -1 : 1), word.end);
        return;
      }
      const layerId = clipUiStore.getState().selectedLayerId;
      if (layerId && (e.key === 'Delete' || e.key === 'Escape')) {
        e.preventDefault();
        if (e.key === 'Delete') deleteLayer(clip.id, layerId);
        selectLayer(null);
        return;
      }
      if (e.key === 'Delete') {
        // With no layer selected: the framing keyframe at the playhead, as the button does.
        const open = projectStore.getState().project?.clips.find((c) => c.id === clip.id);
        if (!open || !player) return;
        const video = videoLayerOf(open);
        const at = player.currentTime;
        const track = propertyFor(valueAt(video.layout, at), half);
        const index = keyAt(video[track], at, rate);
        if (index < 0 || video[track].length === 1) return;
        e.preventDefault();
        deleteKeyframe(clip.id, track, index);
        return;
      }
      if (e.code === 'Space') {
        // Space plays even with a button focused (after clicking a layout, say);
        // Enter still presses the button.
        e.preventDefault();
        toggleClip();
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && player) {
        e.preventDefault();
        const by = (e.shiftKey ? 1 : frame) * (e.key === 'ArrowLeft' ? -1 : 1);
        player.pause();
        seekClip(player.currentTime + by);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [frame, rate, half, clip.id]);

  // A caption font that isn't on this computer is said in the Captions drawer; the rail points there.
  const alerts = captions && !isAvailable(captions.style.font) ? { captions: t('captions.fontMissing', { family: `${captions.style.font.family} ${captions.style.font.weight}` }) } : undefined;

  return (
    <section className={`clip-editor dock-${dock.size}`} data-tool={tool ?? undefined}>
      <div className="clip-stage">
        <header>
          <button type="button" className="back" title={t('clipEditor.close')} onClick={() => openClip(null)}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M7.5 2.5L4 6l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            </svg>
            {t('clipEditor.back')}
          </button>
          <input
            className="clip-name"
            aria-label={t('clipEditor.name')}
            value={clip.name}
            onFocus={() => store.beginGesture('history.renameClip')}
            onChange={(e) => renameClip(clip.id, e.target.value)}
            onBlur={() => store.endGesture()}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <button type="button" className="primary" title={t('export.buttonHelp')} disabled={exporting} onClick={() => void exportClip(clip, source)}>
            {t('export.button')}
          </button>
        </header>

        <div className="clip-frame">
          <ClipPreview clip={clip} source={source}>
            <FramingOverlay clipId={clip.id} layout={layout} half={half} onHalf={setHalf} time={time} sourceSize={sourceSize} />
            <LayerOverlay clip={clip} assets={assets} selectedId={selectedLayer?.id ?? null} time={time} />
            {showPeople && <PeopleOverlay layer={layer} time={time} sourceSize={sourceSize} />}
            {captions && <CaptionOverlay clipId={clip.id} layer={captions} track={captionTrackFor(layout)} time={time} />}
          </ClipPreview>
        </div>

        <div className="transport">
          <button type="button" className="play" disabled={status !== 'ready'} onClick={toggleClip}>
            {playing ? t('clipEditor.pause') : t('clipEditor.play')}
          </button>
          <span className="time">
            {t('clipEditor.time', { current: formatClipTime(outputTime(clip, time)), total: formatClipTime(keptLength(clip)) })}
          </span>
          <div className="layouts" role="group" aria-label={t('clipEditor.layout')}>
            {LAYOUTS.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={layout === l}
                className={layout === l ? 'selected' : undefined}
                title={t(`clipEditor.layoutHelp.${l}`)}
                onClick={() => setLayout(clip.id, time, l)}
              >
                {t(`clipEditor.layouts.${l}`)}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={showPeople}
            title={t('analysis.showPeopleHelp')}
            onClick={() => {
              if (!showPeople) setTool('voices');
              setShowPeople(!showPeople);
            }}
          >
            {t('analysis.showPeople')}
          </button>
        </div>
      </div>

      <ToolRail tool={tool} alerts={alerts} />
      {/* The Text drawer is the episode's transcript, which the workspace puts here. */}
      {tool && tool !== 'text' && (
        <aside className="clip-drawer" aria-label={t(`tools.names.${tool}`)}>
          <header>
            <h2>{t(`tools.names.${tool}`)}</h2>
            <button type="button" className="icon" aria-label={t('tools.close')} title={t('tools.close')} onClick={() => setTool(null)}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </button>
          </header>
          {drawer(tool)}
        </aside>
      )}

      <aside className="clip-side">{side}</aside>

      <ClipDock dock={dock} tools={dockTools()}>
        <ClipTimeline clip={clip} assets={assets} keys={keys} pages={pages} selectedId={selectedLayer?.id ?? null} time={time} />
        {transcript && dock.size !== 'compact' && <WordStrip clip={clip} transcript={transcript} time={time} rate={rate} captions={captions !== null} />}
      </ClipDock>
    </section>
  );

  /**
   * The tools above the timeline: the clip's start and end, then what fits
   * the selection. With the picture selected, Auto frame and its keyframes;
   * with a layer, its name and its place in the stack.
   */
  function dockTools() {
    const rows = rowsOf(clip);
    const row = selectedLayer ? rows.findIndex((l) => l.id === selectedLayer.id) : -1;
    return (
      <>
        <div className="clip-range">
          {EDGES.map((edge) => (
            <div key={edge} className="edge">
              <span className="dim">{t(`clipEditor.${edge}`)}</span>
              <button type="button" className="icon" aria-label={t('clipEditor.earlier', { what: t(`clipEditor.${edge}`) })} title={t('clipEditor.earlier', { what: t(`clipEditor.${edge}`) })} onClick={() => nudgeClip(clip.id, edge, -trimStep)}>
                ‹
              </button>
              <span className="value">{formatClipTime(clip[edge])}</span>
              <button type="button" className="icon" aria-label={t('clipEditor.later', { what: t(`clipEditor.${edge}`) })} title={t('clipEditor.later', { what: t(`clipEditor.${edge}`) })} onClick={() => nudgeClip(clip.id, edge, trimStep)}>
                ›
              </button>
            </div>
          ))}
        </div>
        <div className="dock-context">
          {selectedLayer ? (
            <>
              <span className="selected-name">{layerName(t, selectedLayer, assets)}</span>
              {/* A sound draws nothing, so it has no place in the order. */}
              {selectedLayer.kind !== 'sound' && (
                <>
                  <button type="button" disabled={row <= 0} onClick={() => reorderLayer(clip.id, selectedLayer.id, 'up')}>
                    {t('layers.up')}
                  </button>
                  <button type="button" disabled={row < 0 || row === rows.length - 1} onClick={() => reorderLayer(clip.id, selectedLayer.id, 'down')}>
                    {t('layers.down')}
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <AutoFramePanel clip={clip} time={time} />
              {keyframeControls()}
            </>
          )}
        </div>
      </>
    );
  }

  /** The picture's keyframes, next to the timeline that shows them. */
  function keyframeControls() {
    return (
      <div className="keyframes" role="group" aria-label={t('clipEditor.keyframes')} title={t('clipEditor.keyframeHelp')}>
        <button type="button" disabled={keyIndex >= 0} onClick={() => addKeyframe(clip.id, property, time)}>
          <span className="diamond" aria-hidden="true" />
          {t('clipEditor.addKeyframe')}
        </button>
        <label className={keyIndex < 0 || keyIndex === keys.length - 1 ? 'disabled' : undefined}>
          <input
            type="checkbox"
            disabled={keyIndex < 0 || keyIndex === keys.length - 1}
            checked={keyIndex >= 0 && keys[keyIndex]!.ease === 'smooth'}
            onChange={(e) => setSmooth(clip.id, property, keyIndex, e.target.checked)}
          />
          {t('clipEditor.smooth')}
        </label>
        <button type="button" title={t('clipEditor.deleteKeyframeHelp')} disabled={keyIndex < 0 || keys.length === 1} onClick={() => deleteKeyframe(clip.id, property, keyIndex)}>
          {t('clipEditor.deleteKeyframe')}
        </button>
      </div>
    );
  }

  /** What a tool's drawer holds. A selected layer shows in Layers or Effects. */
  function drawer(open: Exclude<ClipTool, 'text'>) {
    switch (open) {
      case 'framing':
        return framing();
      case 'captions':
        return <CaptionPanel clipId={clip.id} layer={captions} track={captionTrackFor(layout)} time={time} rate={rate} />;
      case 'layers':
        return (
          <>
            {selectedLayer && isPlaced(selectedLayer) ? (
              <LayerPanel
                clipId={clip.id}
                layer={selectedLayer}
                asset={assets.find((a) => a.id === selectedLayer.assetId)}
                time={time}
                rate={rate}
                overLimit={videoLayersOverLimit(clip).has(selectedLayer.id)}
              />
            ) : (
              <p className="dim hint">{t('tools.layersHint')}</p>
            )}
            <LayerTiles clipId={clip.id} time={time} />
          </>
        );
      case 'effects':
        return (
          <>
            {selectedLayer?.kind === 'effect' ? <EffectPanel clipId={clip.id} layer={selectedLayer} time={time} rate={rate} /> : <p className="dim hint">{t('tools.effectsHint')}</p>}
            <EffectLibrary clipId={clip.id} time={time} />
          </>
        );
      case 'sound':
        return (
          <>
            {selectedLayer?.kind === 'sound' ? <SoundPanel clipId={clip.id} layer={selectedLayer} assets={assets} /> : <p className="dim hint">{t('tools.soundHint')}</p>}
            <SoundLibrary clipId={clip.id} time={time} />
          </>
        );
      case 'pauses':
        return <SilencePanel clip={clip} />;
      case 'voices':
        return (
          <>
            {showPeople ? <WhoTalks time={time} /> : <p className="dim hint">{t('tools.voicesHint')}</p>}
            {voices}
          </>
        );
    }
  }

  /** The source video's framing: how to move it, and its zoom. */
  function framing() {
    return (
      <>
        <p className="dim hint">
          {t('clipEditor.dragHint')}
          {layout === 'split' && ` ${t('clipEditor.editing', { what: t(`clipEditor.${half}`) })}`}
        </p>

        <label className="zoom">
          <span>{t('clipEditor.zoom')}</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={value.zoom}
            disabled={!sourceSize}
            onPointerDown={() => store.beginGesture('history.zoomFrame')}
            onPointerUp={() => store.endGesture()}
            onChange={(e) => {
              if (!sourceSize) return;
              const region = regionFor(layout, half);
              const next = zoomed(value, property, region, sourceSize, Number(e.target.value), region.x + region.w / 2, region.y + region.h / 2);
              setFraming(clip.id, 'history.zoomFrame', property, time, next);
            }}
          />
        </label>
      </>
    );
  }
}
