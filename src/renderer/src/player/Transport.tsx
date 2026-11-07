import { useTranslation } from 'react-i18next';
import { formatDuration } from '../format.ts';
import { toggleMute, togglePlay, usePlayback } from './playback.ts';

/** Under the episode's picture: play or pause, where it is, and the sound on or off. */
export function Transport({ duration }: { duration: number }) {
  const { t } = useTranslation();
  const playing = usePlayback((s) => s.playing);
  const muted = usePlayback((s) => s.muted);
  // Whole seconds, so the clock re-renders once a second and not every frame.
  const second = usePlayback((s) => Math.floor(s.time));
  return (
    <div className="episode-transport">
      <button type="button" className="play" aria-label={t(playing ? 'player.pause' : 'player.play')} title={t('player.playHelp')} onClick={togglePlay}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          {playing ? (
            <>
              <rect x="4" y="3" width="3" height="10" rx="1" />
              <rect x="9" y="3" width="3" height="10" rx="1" />
            </>
          ) : (
            <path d="M5 3l8 5-8 5z" />
          )}
        </svg>
      </button>
      <span className="clock">
        {formatDuration(second)} <small>/ {formatDuration(duration)}</small>
      </span>
      <button type="button" className="icon mute" aria-pressed={muted} aria-label={t('player.mute')} title={t('player.mute')} onClick={toggleMute}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 6h2.5l3.5-3v10L5 10H2.5z" className="solid" />
          {muted ? <path d="M11 6l3.5 4M14.5 6L11 10" /> : <path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.5a6 6 0 0 1 0 9" />}
        </svg>
      </button>
    </div>
  );
}
