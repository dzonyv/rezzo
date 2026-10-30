import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Source } from '../../../shared/project.ts';
import { clipUiStore } from '../clip/state.ts';
import { isTypingTarget } from '../ui/focus.ts';
import { attachVideo, togglePlay } from './playback.ts';

type Preview = { state: 'none' } | { state: 'making'; fraction: number } | { state: 'failed'; detail: string };

/**
 * Plays the source episode. Chromium plays most H.264/AAC files directly;
 * anything it can't decode switches to a 480p preview made once in the
 * background. Give it `key={source.fingerprint}` so a different source
 * starts from a clean state.
 */
export function EpisodePlayer({ source }: { source: Source }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview>({ state: 'none' });
  const usingPreview = useRef(false);

  useEffect(() => {
    let current = true;
    void window.rezzo.invoke('episode:media-url', source).then((u) => current && setUrl(u));
    return () => {
      current = false;
    };
  }, [source]);

  useEffect(
    () =>
      window.rezzo.on('episode:preview-progress', ({ fingerprint, fraction }) => {
        if (fingerprint === source.fingerprint) setPreview({ state: 'making', fraction });
      }),
    [source.fingerprint],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTypingTarget(e.target)) return;
      // With a clip open, Space plays the clip.
      if (clipUiStore.getState().openClipId) return;
      // These already do something with Space.
      if (['SELECT', 'BUTTON', 'VIDEO'].includes((e.target as HTMLElement).tagName)) return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const fallBackToPreview = async () => {
    if (usingPreview.current) return;
    usingPreview.current = true;
    setPreview({ state: 'making', fraction: 0 });
    try {
      setUrl(await window.rezzo.invoke('episode:preview', source));
      setPreview({ state: 'none' });
    } catch (e) {
      setPreview({ state: 'failed', detail: String(e) });
    }
  };

  return (
    <div className="player">
      {preview.state === 'making' && (
        <div className="player-message">
          <span>{t('player.preparing', { percent: Math.round(preview.fraction * 100) })}</span>
          <progress max={1} value={preview.fraction} />
        </div>
      )}
      {preview.state === 'failed' && <div className="player-message">{t('player.failed', { detail: preview.detail })}</div>}
      {url && preview.state === 'none' && (
        <video
          ref={attachVideo}
          src={url}
          controls
          preload="auto"
          onError={() => void fallBackToPreview()}
          // Audio plays but the picture can't be decoded (e.g. HEVC without hardware support).
          onLoadedMetadata={(e) => e.currentTarget.videoWidth === 0 && void fallBackToPreview()}
        />
      )}
    </div>
  );
}
