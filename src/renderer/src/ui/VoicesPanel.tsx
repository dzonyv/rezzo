import { useTranslation } from 'react-i18next';
import type { Project } from '../../../shared/project.ts';
import { MAX_SPEAKERS, type SpeakerCount } from '../../../shared/voices.ts';
import { formatDuration } from '../format.ts';
import { retryVoices, setSpeakerCount, talkTimes, useVoices } from '../project/voices.ts';
import { voiceColor } from '../voice-colors.ts';

const AUTO: SpeakerCount = 'auto';

/** The episode's voices: how many, how much each talks, and how many people there should be. */
export function VoicesPanel({ project }: { project: Project }) {
  const { t } = useTranslation();
  const status = useVoices((s) => s.status);
  const progress = useVoices((s) => s.progress);
  const voices = useVoices((s) => s.voices);
  const detail = useVoices((s) => s.detail);

  return (
    <section className="voices-panel">
      <h2>{t('voices.title')}</h2>
      {status === 'running' && (
        <div className="progress-line">
          <span>{t(`voices.phase.${progress?.phase ?? 'voices'}`, { percent: Math.round((progress?.fraction ?? 0) * 100) })}</span>
          <progress max={1} value={progress?.fraction ?? 0} />
        </div>
      )}
      {status === 'failed' && (
        <div className="banner warning">
          <span>{t('voices.failed', { detail })}</span>
          <button type="button" onClick={retryVoices}>
            {t('voices.retry')}
          </button>
        </div>
      )}
      {status === 'ready' && voices && (
        <ul className="voice-list">
          {talkTimes(voices).map((seconds, v) => (
            <li key={v}>
              <span className="voice-chip" style={{ background: voiceColor(v) }} />
              {t('voices.voice', { n: v + 1 })}
              <span className="dim">{formatDuration(seconds)}</span>
            </li>
          ))}
        </ul>
      )}
      <label>
        {t('voices.count')}
        <select
          value={String(project.voices.count)}
          onChange={(e) => setSpeakerCount(e.target.value === AUTO ? AUTO : (Number(e.target.value) as SpeakerCount))}
        >
          <option value={AUTO}>{t('voices.countAuto')}</option>
          {Array.from({ length: MAX_SPEAKERS }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
