import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TranscriptionStatus } from '../../../shared/api.ts';
import { TRANSCRIPT_LANGUAGES, type Project, type TranscriptLanguage } from '../../../shared/project.ts';
import type { TranscribeProgress } from '../../../shared/worker-api.ts';
import { cancelTranscription, startTranscription, useTranscription } from '../project/transcription.ts';

/** Shown until the project has a transcript: pick the language, start, watch it run. */
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

  if (!project.source?.audio) {
    return <section className="transcribe-panel">{t('transcribe.noAudio')}</section>;
  }

  const running = runningFor === project.id;
  const busyElsewhere = runningFor !== null && !running;

  return (
    <section className="transcribe-panel">
      <h2>{t('transcribe.title')}</h2>
      {running ? (
        <>
          <ProgressLine progress={progress} />
          <button type="button" onClick={cancelTranscription}>
            {t('transcribe.cancel')}
          </button>
        </>
      ) : (
        <>
          <p className="dim">{t('transcribe.languageHelp')}</p>
          <div className="row">
            <label>
              {t('transcribe.language')}
              <select value={language ?? TRANSCRIPT_LANGUAGES[0]} onChange={(e) => setLanguage(e.target.value as TranscriptLanguage)}>
                {TRANSCRIPT_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {t(`transcribe.languages.${l}`)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="primary"
              disabled={!language || busyElsewhere}
              onClick={() => language && void startTranscription(language)}
            >
              {t('transcribe.start')}
            </button>
          </div>
          {status && status.downloadBytes > 0 && (
            <p className="dim">{t('transcribe.download', { size: (status.downloadBytes / 1e9).toFixed(1) })}</p>
          )}
          {status?.device === 'cpu' && <p className="dim">{t('transcribe.cpu')}</p>}
        </>
      )}
    </section>
  );
}

function ProgressLine({ progress }: { progress: TranscribeProgress | null }) {
  const { t } = useTranslation();
  let label = t('transcribe.phase.starting');
  let fraction = 0;
  if (progress?.phase === 'download') {
    fraction = progress.received / progress.total;
    label = t('transcribe.phase.download', {
      received: (progress.received / 1e6).toFixed(0),
      total: (progress.total / 1e6).toFixed(0),
    });
  } else if (progress) {
    fraction = progress.fraction;
    label = t(`transcribe.phase.${progress.phase}`, { percent: Math.round(progress.fraction * 100) });
  }
  return (
    <div className="progress-line">
      <span>{label}</span>
      <progress max={1} value={fraction} />
    </div>
  );
}
