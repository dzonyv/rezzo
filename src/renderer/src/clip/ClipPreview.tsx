import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { frameRecipe } from '../../../shared/framing.ts';
import { videoLayerOf, type Clip, type Source } from '../../../shared/project.ts';
import { ClipPlayer, type RecipeAt } from '../render/clip-player.ts';
import { Compositor } from '../render/compositor.ts';
import { clipPlaybackStore, currentPlayer, setPlayer, useClipPlayback } from './playback.ts';

/** Trimming a clip in small steps shouldn't start a conversion for every step. */
const TRIM_SETTLE_MS = 400;

/**
 * The 9:16 preview of the open clip. Makes sure there's a working file for
 * the clip's range, plays it through the compositor, and redraws when the
 * framing changes. Children are drawn over the picture (the framing handles).
 */
export function ClipPreview({ clip, source, children }: { clip: Clip; source: Source; children?: React.ReactNode }) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const compositor = useRef<Compositor | null>(null);
  // Bumped when the GPU context comes back after being lost: everything is rebuilt.
  const [generation, setGeneration] = useState(0);
  const status = useClipPlayback((s) => s.status);
  const progress = useClipPlayback((s) => s.progress);
  const error = useClipPlayback((s) => s.error);

  const layer = videoLayerOf(clip);
  /** The framing a player loading in the background will start with. */
  const recipeAt = useRef<RecipeAt>((time, size) => frameRecipe(layer, time, size));

  useEffect(() => {
    const el = canvas.current!;
    const c = new Compositor(el);
    compositor.current = c;
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
          const player = await ClipPlayer.load(result, c, range, (time, size) => recipeAt.current(time, size));
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

  // New framing: redraw the frame on screen.
  useEffect(() => {
    recipeAt.current = (time, size) => frameRecipe(layer, time, size);
    currentPlayer()?.setRecipe(recipeAt.current);
  }, [layer]);

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
