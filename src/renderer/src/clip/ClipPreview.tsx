import i18n from 'i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import type { Asset } from '../../../shared/assets.ts';
import { workingFrameRate } from '../../../shared/frames.ts';
import { videoLayersOf } from '../../../shared/overlay-files.ts';
import { captionLayerOf, type Clip, type Source } from '../../../shared/project.ts';
import { markMissing } from '../project/assets.ts';
import { useProject } from '../project/store.ts';
import { loadCaptionScene, type CaptionScene } from '../render/captions.ts';
import { ClipPlayer, type DrawAt, type LayerSound, type PrepareAt } from '../render/clip-player.ts';
import { analyse } from '../analysis/store.ts';
import { Compositor, type LayerImage } from '../render/compositor.ts';
import { forgetOverlayFile, overlayFilesStore, prepareOverlayFiles, readyFiles, retryFailedOverlayFiles, WorkingFileGoneError, type OverlayFile } from '../render/overlay-files.ts';
import { layerSounds } from '../render/layer-sound.ts';
import { evenGain } from '../../../shared/loudness.ts';
import { evensLoudness, soundLayersOf } from '../../../shared/sound-mix.ts';
import { assetLoudnessOf, loudnessStore, measuredLoudness, requestAssetLoudness, useClipLoudness } from '../render/loudness.ts';
import type { LottieData } from '../render/lottie.ts';
import { assetsOf, loadImages, loadLotties, SceneRenderer } from '../render/scene-renderer.ts';
import { useSettings } from '../settings.ts';
import { flatOf } from '../transcript/words.ts';
import { notify } from '../ui/prompts.ts';
import { setSampler } from './eyedropper.ts';
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
  const [lotties, setLotties] = useState<ReadonlyMap<string, LottieData>>(new Map());
  /** What a player loading in the background will start with. */
  const drawAt = useRef<DrawAt>(() => {});
  const prepareAt = useRef<PrepareAt>(() => Promise.resolve(false));
  const overlayStates = useStore(overlayFilesStore, (s) => s.files);
  const overlays = useMemo(() => readyFiles(overlayStates), [overlayStates]);
  /** The video layers' sound, for a player that loads later too. */
  const sounds = useRef<LayerSound[]>([]);
  /** Asks for the video layers' working files again, as they are now. */
  const prepareFiles = useRef(() => {});
  // The clip's own sound, evened out once it's measured.
  const clipLoudness = useClipLoudness(source, clip, status === 'ready');
  const clipGain = evenGain(measuredLoudness(clipLoudness), clip.evenLoudness);
  /** The same, for a player that loads later. */
  const clipGainNow = useRef(clipGain);
  const heardSounds = soundLayersOf(clip, allAssets ?? []);
  const measured = useStore(loudnessStore, (s) => s.measured);
  // Sound files that are evened out, by layer id: turned up or down once they're measured.
  const gains = Object.fromEntries(
    heardSounds.flatMap(({ layer, asset }) => (asset && evensLoudness(layer) ? [[layer.id, evenGain(measuredLoudness(assetLoudnessOf(measured, asset)), true)]] : [])),
  );
  // What the layers' sound depends on, as a value that changes only when that does (not when a layer moves on screen).
  const soundJson = JSON.stringify({
    clip: {
      start: clip.start,
      end: clip.end,
      skips: clip.skips,
      layers: clip.layers.flatMap((l): object[] =>
        l.kind === 'overlay'
          ? [{ id: l.id, kind: l.kind, assetId: l.assetId, start: l.start, end: l.end, offset: l.offset, loop: l.loop, volume: l.volume }]
          : l.kind === 'sound'
            ? [l]
            : [],
      ),
    },
    assets: [...videoLayersOf(clip, allAssets ?? []), ...heardSounds].flatMap(({ asset }) => (asset ? [asset] : [])),
    files: [...overlays].filter(([id]) => clip.layers.some((l) => l.id === id)),
    gains,
  });
  const soundInput = useMemo(
    () => JSON.parse(soundJson) as { clip: Clip; assets: Asset[]; files: [string, OverlayFile][]; gains: Record<string, number> },
    [soundJson],
  );

  // The files the layers show, as a value that changes only when they do (not when a layer moves).
  const usedJson = JSON.stringify(assetsOf(clip, allAssets ?? []));
  const used = useMemo(() => JSON.parse(usedJson) as Asset[], [usedJson]);

  useEffect(() => {
    const el = canvas.current!;
    const c = new Compositor(el);
    compositor.current = c;
    const r = new SceneRenderer(c);
    renderer.current = r;
    r.layers.onError = (layerId, e) => {
      // Its working file was pruned or deleted: made again, quietly.
      if (e instanceof WorkingFileGoneError) {
        forgetOverlayFile(layerId);
        prepareFiles.current();
      } else {
        notify('error', i18n.t('layers.errors.prepare', { detail: e instanceof Error ? e.message : String(e) }));
      }
    };
    r.lotties.onError = (_layerId, e) => notify('error', i18n.t('layers.errors.lottie.play', { detail: e instanceof Error ? e.message : String(e) }));
    setSampler((layerId, assetId, u, v) => c.sampleLayer(layerId, assetId, u, v));
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
      setSampler(null);
      r.dispose();
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
      playing.setRange({ ...range, skips: clip.skips });
      // A trim past this file and straight back: the new file that was being made isn't needed after all.
      const { status } = clipPlaybackStore.getState();
      if (status === 'preparing' || status === 'loading') clipPlaybackStore.setState({ status: 'ready', progress: 0, error: null });
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
          const player = await ClipPlayer.load(result, c, { ...range, skips: clip.skips }, (time) => drawAt.current(time));
          if (cancelled) {
            player.dispose();
            return;
          }
          player.onError = (e) => clipPlaybackStore.setState({ status: 'failed', error: String(e) });
          player.setScene(drawAt.current, prepareAt.current);
          player.setSounds(sounds.current);
          player.setClipGain(clipGainNow.current);
          setPlayer(player);
          clipPlaybackStore.setState({ status: 'ready' });
          // Cuts and people for the timeline and the "show people" view; in the background.
          void analyse(result);
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
  }, [clip.start, clip.end, clip.skips, source, generation]);

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

  // The layers' pictures and animations. One that can't be read is left out, and the editor offers to find it.
  useEffect(() => {
    let current = true;
    const onMissing = (a: Asset) => current && markMissing(a.id, true);
    void Promise.all([loadImages(used, { onMissing }), loadLotties(used, { onMissing })]).then(([loadedImages, loadedLotties]) => {
      if (!current) return;
      for (const a of used) if (loadedImages.has(a.id) || loadedLotties.has(a.id)) markMissing(a.id, false);
      setImages(loadedImages);
      setLotties(loadedLotties);
    });
    return () => {
      current = false;
    };
  }, [used]);

  // A clip opened again gives layers whose file failed or went missing another try.
  useEffect(() => retryFailedOverlayFiles(), []);

  // Working files for the video layers, made in the background; the timeline shows their progress.
  useEffect(() => {
    prepareFiles.current = () => prepareOverlayFiles(clip, allAssets ?? [], workingFrameRate(source));
    prepareFiles.current();
  }, [clip, allAssets, source]);

  // The layers' sound: the video layers' once their working files are there.
  useEffect(() => {
    let current = true;
    const onFile = (a: Asset, there: boolean) => current && markMissing(a.id, !there);
    for (const { layer, asset } of soundLayersOf(soundInput.clip, soundInput.assets)) if (asset && evensLoudness(layer)) requestAssetLoudness(asset);
    void layerSounds(soundInput.clip, soundInput.assets, new Map(soundInput.files), soundInput.gains, onFile).then((s) => {
      if (!current) return;
      sounds.current = s;
      currentPlayer()?.setSounds(s);
    });
    return () => {
      current = false;
    };
  }, [soundInput]);

  useEffect(() => {
    clipGainNow.current = clipGain;
    currentPlayer()?.setClipGain(clipGain);
  }, [clipGain]);

  // Anything in the clip changed: redraw the frame on screen.
  useEffect(() => {
    const assets = allAssets ?? [];
    const s = { clip, assets, captions: scene, images, overlays, lotties };
    drawAt.current = (time) => renderer.current?.draw(s, time);
    prepareAt.current = (time, sequential) => renderer.current?.prepare(s, time, sequential) ?? Promise.resolve(false);
    currentPlayer()?.setScene(drawAt.current, prepareAt.current);
  }, [clip, allAssets, scene, images, overlays, lotties, generation]);

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
