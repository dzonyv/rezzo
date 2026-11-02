import i18n from 'i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Asset } from '../../../shared/assets.ts';
import { workingFrameRate } from '../../../shared/frames.ts';
import { captionLayerOf, type Clip, type Source } from '../../../shared/project.ts';
import { markMissing } from '../project/assets.ts';
import { useProject } from '../project/store.ts';
import { loadCaptionScene, type CaptionScene } from '../render/captions.ts';
import { ClipPlayer, type DrawAt } from '../render/clip-player.ts';
import { Compositor, type LayerImage } from '../render/compositor.ts';
import { prepareOverlayFiles } from '../render/overlay-files.ts';
import { assetsOf, loadImages, SceneRenderer } from '../render/scene-renderer.ts';
import { useSettings } from '../settings.ts';
import { flatOf } from '../transcript/words.ts';
import { notify } from '../ui/prompts.ts';
import { clipPlaybackStore, currentPlayer, setPlayer, useClipPlayback } from './playback.ts';

/** Trimming a clip in small steps shouldn't start a conversion for every step. */
const TRIM_SETTLE_MS = 400;

/**
 * The 9:16 preview of the open clip. Makes sure there's a working file for
 * the clip's range, plays it through the compositor, and redraws when
 * anything in the clip changes. Children are drawn over the picture (the
 * framing, caption and layer handles).
 */
export function ClipPreview({ clip, source, children }: { clip: Clip; source: Source; children?: React.ReactNode }) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const compositor = useRef<Compositor | null>(null);
  const renderer = useRef<SceneRenderer | null>(null);
  // Bumped when the GPU context comes back after being lost: everything is rebuilt.
  const [generation, setGeneration] = useState(0);
  const status = useClipPlayback((s) => s.status);
  const progress = useClipPlayback((s) => s.progress);
  const error = useClipPlayback((s) => s.error);

  const captions = captionLayerOf(clip);
  const segments = useProject((s) => s.project?.transcript?.segments);
  const allAssets = useProject((s) => s.project?.assets);
  // Adding a font the captions were missing changes how they're drawn.
  const fonts = useSettings((s) => s.fonts);
  const [scene, setScene] = useState<CaptionScene | null>(null);
  const [images, setImages] = useState<ReadonlyMap<string, LayerImage>>(new Map());
  /** What a player loading in the background will start with. */
  const drawAt = useRef<DrawAt>(() => {});

  // The files the layers show, as a value that changes only when they do (not when a layer moves).
  const usedJson = JSON.stringify(assetsOf(clip, allAssets ?? []));
  const used = useMemo(() => JSON.parse(usedJson) as Asset[], [usedJson]);

  useEffect(() => {
    const el = canvas.current!;
    const c = new Compositor(el);
    compositor.current = c;
    renderer.current = new SceneRenderer(c);
    const resize = new ResizeObserver(() => {
      el.width = Math.round(el.clientWidth * devicePixelRatio);
      el.height = Math.round(el.clientHeight * devicePixelRatio);
      c.present();
    });
    resize.observe(el);
    const lost = (e: Event) => {
      e.preventDefault(); // lets the browser give the context back
      setPlayer(null);
      compositor.current = null;
    };
    const restored = () => setGeneration((g) => g + 1);
    el.addEventListener('webglcontextlost', lost);
    el.addEventListener('webglcontextrestored', restored);
    // For the end-to-end tests: what the renderer drew.
    Object.assign(window, {
      __rezzoPreview: { readRow: (y: number) => Array.from(c.readRow(y)), hasAudio: () => currentPlayer()?.hasAudio ?? null },
    });
    return () => {
      resize.disconnect();
      el.removeEventListener('webglcontextlost', lost);
      el.removeEventListener('webglcontextrestored', restored);
      setPlayer(null);
      compositor.current = null;
      renderer.current = null;
      c.dispose();
    };
  }, [generation]);

  useEffect(
    () => window.rezzo.on('clip:prepare-progress', ({ fraction }) => clipPlaybackStore.setState({ progress: fraction })),
    [],
  );

  // A working file that holds the clip's range: the one playing if it still fits, else a new one.
  useEffect(() => {
    const range = { start: clip.start, end: clip.end };
    const playing = currentPlayer();
    if (playing && playing.file.start <= range.start + 1e-6 && playing.file.end >= range.end - 1e-6) {
      playing.setRange(range);
      return;
    }
    playing?.pause();
    let cancelled = false;
    clipPlaybackStore.setState({ status: 'preparing', progress: 0, error: null });
    const timer = setTimeout(
      async () => {
        try {
          const result = await window.rezzo.invoke('clip:prepare', source, range);
          if (cancelled) return;
          if (!result.ok) {
            if (result.error === 'failed') clipPlaybackStore.setState({ status: 'failed', error: result.detail });
            return;
          }
          clipPlaybackStore.setState({ status: 'loading' });
          const c = compositor.current;
          if (!c) return;
          const player = await ClipPlayer.load(result, c, range, (time) => drawAt.current(time));
          if (cancelled) {
            player.dispose();
            return;
          }
          player.onError = (e) => clipPlaybackStore.setState({ status: 'failed', error: String(e) });
          setPlayer(player);
          clipPlaybackStore.setState({ status: 'ready' });
        } catch (e) {
          if (!cancelled) clipPlaybackStore.setState({ status: 'failed', error: String(e) });
        }
      },
      playing ? TRIM_SETTLE_MS : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [clip.start, clip.end, source, generation]);

  // The captions as the painter wants them, once their font is in. If that
  // fails the picture still plays, without captions.
  useEffect(() => {
    let current = true;
    loadCaptionScene(captions, segments ? flatOf(segments).words : [], { start: clip.start, end: clip.end })
      .then((s) => current && setScene(s))
      .catch((e: unknown) => {
        if (!current) return;
        setScene(null);
        notify('error', i18n.t('errors.unexpected', { detail: e instanceof Error ? e.message : String(e) }));
      });
    return () => {
      current = false;
    };
  }, [captions, segments, fonts, clip.start, clip.end]);

  // The layers' pictures. One that can't be read is left out, and the editor offers to find it.
  useEffect(() => {
    let current = true;
    void loadImages(used, { onMissing: (a) => current && markMissing(a.id, true) }).then((loaded) => {
      if (!current) return;
      for (const a of used) if (loaded.has(a.id)) markMissing(a.id, false);
      setImages(loaded);
    });
    return () => {
      current = false;
    };
  }, [used]);

  // Working files for the video layers, made in the background; the timeline shows their progress.
  useEffect(() => {
    prepareOverlayFiles(clip, allAssets ?? [], workingFrameRate(source));
  }, [clip, allAssets, source]);

  // Anything in the clip changed: redraw the frame on screen.
  useEffect(() => {
    const assets = allAssets ?? [];
    drawAt.current = (time) => renderer.current?.draw({ clip, assets, captions: scene, images }, time);
    currentPlayer()?.setScene(drawAt.current);
  }, [clip, allAssets, scene, images, generation]);

  return (
    <div className="clip-preview">
      <canvas ref={canvas} />
      {children}
      {status === 'preparing' && (
        <div className="clip-preview-message">
          <span>{t('clipEditor.preparing', { percent: Math.round(progress * 100) })}</span>
          <progress max={1} value={progress} />
        </div>
      )}
      {status === 'failed' && <div className="clip-preview-message">{t('clipEditor.failed', { detail: error })}</div>}
    </div>
  );
}
