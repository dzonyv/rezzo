import { useTranslation } from 'react-i18next';
import type { Project } from '../../../shared/project.ts';
import { MAX_SPEAKERS, type HeardVoice, type SpeakerCount } from '../../../shared/voices.ts';
import { formatDuration } from '../format.ts';
import { forgetVoiceEdits, mergeVoice, nameVoice, retryVoices, setSpeakerCount, useHeardVoices, useVoices } from '../project/voices.ts';
import { voiceColor, voiceLabel } from '../voice-colors.ts';

const AUTO: SpeakerCount = 'auto';

/** The episode's voices: how many, how much each talks, what they're called, and how many people there should be. */
export function VoicesPanel({ project }: { project: Project }) {
  const { t } = useTranslation();
  const status = useVoices((s) => s.status);
  const progress = useVoices((s) => s.progress);
  const heard = useHeardVoices();
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
      {/* The last result stays up while a new one is worked out. */}
      {heard && (
        <ul className="voice-list">
          {heard.voices.map((voice) => (
            <VoiceRow key={voice.id} voice={voice} others={heard.voices.filter((v) => v.id !== voice.id)} />
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
      {project.voices.edits.length + project.voices.picks.length > 0 && (
        <button type="button" onClick={forgetVoiceEdits}>
          {t('voices.forget')}
        </button>
      )}
    </section>
  );
}

/** One voice: its colour, a box for its name, how long it talks, and who else it might be. */
function VoiceRow({ voice, others }: { voice: HeardVoice; others: readonly HeardVoice[] }) {
  const { t } = useTranslation();
  const label = voiceLabel(t, voice);
  return (
    <li>
      <span className="voice-chip" style={{ background: voiceColor(voice.id) }} />
      <input
        // A new name from undo or a new result replaces what's in the box.
        key={voice.name ?? ''}
        aria-label={t('voices.name', { voice: t('voices.voice', { n: voice.id + 1 }) })}
        placeholder={t('voices.voice', { n: voice.id + 1 })}
        defaultValue={voice.name ?? ''}
        onBlur={(e) => {
          const name = e.target.value.trim();
          if (name !== (voice.name ?? '')) nameVoice(voice.at, name);
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <span className="dim">{formatDuration(voice.seconds)}</span>
      {others.length > 0 && (
        <select
          aria-label={t('voices.mergeInto', { voice: label })}
          value=""
          onChange={(e) => e.target.value && mergeVoice(voice.at, Number(e.target.value))}
        >
          <option value="">{t('voices.sameAs')}</option>
          {others.map((other) => (
            <option key={other.id} value={other.at}>
              {voiceLabel(t, other)}
            </option>
          ))}
        </select>
      )}
    </li>
  );
}
