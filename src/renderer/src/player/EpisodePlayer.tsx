import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Source } from '../../../shared/project.ts';
import { clipUiStore } from '../clip/state.ts';
import { isTypingTarget } from '../ui/focus.ts';
import { attachVideo, togglePlay } from './playback.ts';

type Preview =
  | { state: 'none' }
  | { state: 'making'; fraction: number }
  | { state: 'failed'; detail: string }
  /** The file moved or changed: no preview is made, SourcePanel's banner offers to find it. */
  | { state: 'missing' };

/**
 * Plays the source episode. Chromium plays most H.264/AAC files directly;
 * anything it can't decode switches to a 480p preview made once in the
 * background. Give it `key={source.fingerprint}` so a different source
 * starts from a clean state; the same source found somewhere else (a new
 * `source` object) starts over too.
 */
export function EpisodePlayer({ source }: { source: Source }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview>({ state: 'none' });
  const usingPreview = useRef(false);
  // Bumped for each `source`, so a fallback started for the old one doesn't land on the new one.
  const attempt = useRef(0);

  useEffect(() => {
    let current = true;
    attempt.current++;
    usingPreview.current = false;
    void window.rezzo.invoke('episode:media-url', source).then((u) => {
      if (!current) return;
      // Found again after it went missing: back to playing the file itself.
      setPreview({ state: 'none' });
      setUrl(u);
    });
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
      if (['SELECT', 'BUTTON'].includes((e.target as HTMLElement).tagName)) return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const fallBackToPreview = async () => {
    if (usingPreview.current) return;
    usingPreview.current = true;
    const mine = attempt.current;
    // A file that isn't there (or isn't the one imported) can't be played or converted either.
    if ((await window.rezzo.invoke('episode:check', source)) !== 'ok') {
      if (mine === attempt.current) setPreview({ state: 'missing' });
      return;
    }
    if (mine !== attempt.current) return;
    setPreview({ state: 'making', fraction: 0 });
    try {
      const previewUrl = await window.rezzo.invoke('episode:preview', source);
      if (mine !== attempt.current) return;
      setUrl(previewUrl);
      setPreview({ state: 'none' });
    } catch (e) {
      if (mine === attempt.current) setPreview({ state: 'failed', detail: String(e) });
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
      {preview.state === 'missing' && <div className="player-message">{t('player.missing')}</div>}
      {preview.state === 'failed' && <div className="player-message">{t('player.failed', { detail: preview.detail })}</div>}
      {url && preview.state === 'none' && (
        <video
          ref={attachVideo}
          src={url}
          preload="auto"
          // The transport under the picture and the episode strip stand in for the native controls.
          onClick={togglePlay}
          onError={() => void fallBackToPreview()}
          // Audio plays but the picture can't be decoded (e.g. HEVC without hardware support).
          onLoadedMetadata={(e) => e.currentTarget.videoWidth === 0 && void fallBackToPreview()}
        />
      )}
    </div>
  );
}
