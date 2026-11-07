import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TranscriptionStatus } from '../../../shared/api.ts';
import { TRANSCRIPT_LANGUAGES, type Project, type TranscriptLanguage } from '../../../shared/project.ts';
import type { TranscribeProgress } from '../../../shared/worker-api.ts';
import { cancelTranscription, startTranscription, useTranscription } from '../project/transcription.ts';

/**
 * Beside the video until the project has a transcript: pick the spoken
 * language, start, watch it run. The episode screen takes over by itself
 * when the transcript is in.
 */
export function TranscribePanel({ project }: { project: Project }) {
  const { t } = useTranslation();
  const runningFor = useTranscription((s) => s.projectId);
  const progress = useTranscription((s) => s.progress);
  const [status, setStatus] = useState<TranscriptionStatus | null>(null);
  const [language, setLanguage] = useState<TranscriptLanguage | null>(null);

  useEffect(() => {
    void window.rezzo.invoke('transcribe:status').then(setStatus);
    void window.rezzo.invoke('settings:get').then((s) => setLanguage((l) => l ?? s.transcriptLanguage));
  }, [runningFor]);

  const running = runningFor === project.id;
  const busyElsewhere = runningFor !== null && !running;

  return (
    <section className="transcribe-panel" aria-labelledby="transcribe-title">
      <h2 id="transcribe-title">{t('transcribe.title')}</h2>
      {!project.source?.audio ? (
        <p>{t('transcribe.noAudio')}</p>
      ) : running ? (
        <>
          <Progress progress={progress} />
          <button type="button" onClick={cancelTranscription}>
            {t('transcribe.cancel')}
          </button>
        </>
      ) : (
        <>
          <p>{t('transcribe.languageHelp')}</p>
          <div className="spoken-languages" role="group" aria-label={t('transcribe.language')}>
            {TRANSCRIPT_LANGUAGES.map((l) => (
              <button key={l} type="button" aria-pressed={language === l} onClick={() => setLanguage(l)}>
                {t(`transcribe.languages.${l}`)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="primary"
            disabled={!language || busyElsewhere}
            onClick={() => language && void startTranscription(language)}
          >
            {t('transcribe.start')}
          </button>
          {busyElsewhere && <p className="dim">{t('transcribe.busy')}</p>}
          {status && status.downloadBytes > 0 && (
            <p className="dim">{t('transcribe.download', { size: (status.downloadBytes / 1e9).toFixed(1) })}</p>
          )}
          {status?.device === 'cpu' && <p className="dim">{t('transcribe.cpu')}</p>}
        </>
      )}
    </section>
  );
}

/** What it's doing, a big percentage, and a bar. */
function Progress({ progress }: { progress: TranscribeProgress | null }) {
  const { t } = useTranslation();
  let label = t('transcribe.phase.starting');
  let fraction: number | null = null;
  if (progress?.phase === 'download') {
    fraction = progress.received / progress.total;
    label = t('transcribe.phase.download', {
      received: (progress.received / 1e6).toFixed(0),
      total: (progress.total / 1e6).toFixed(0),
    });
  } else if (progress) {
    fraction = progress.fraction;
    label = t(`transcribe.phase.${progress.phase}`);
  }
  return (
    <div className="big-progress">
      <div className="label">
        <span>{label}</span>
        {fraction !== null && <b className="percent">{Math.round(fraction * 100)}%</b>}
      </div>
      <progress aria-label={label} max={1} value={fraction ?? undefined} />
    </div>
  );
}
