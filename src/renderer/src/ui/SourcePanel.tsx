import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SourceStatus } from '../../../shared/api.ts';
import type { Source } from '../../../shared/project.ts';
import { fileName, formatDuration, formatFrameRate } from '../format.ts';
import { locateSource } from '../project/actions.ts';

/** The source episode: what it is, and a way to find it if it has moved. */
export function SourcePanel({ source }: { source: Source }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SourceStatus>('ok');

  useEffect(() => {
    let current = true;
    void window.rezzo.invoke('episode:check', source).then((s) => current && setStatus(s));
    return () => {
      current = false;
    };
  }, [source]);

  const { video, audio } = source;
  return (
    <section className="source-panel">
      {status !== 'ok' && (
        <div className="banner warning">
          <span>{t(status === 'missing' ? 'episode.missing' : 'episode.changed', { path: source.path })}</span>
          <button type="button" onClick={() => void locateSource()}>
            {t('episode.locate')}
          </button>
        </div>
      )}
      <h2 title={source.path}>{fileName(source.path)}</h2>
      <dl>
        <dt>{t('episode.duration')}</dt>
        <dd>{formatDuration(source.duration)}</dd>
        <dt>{t('episode.video')}</dt>
        <dd>
          {t('episode.videoInfo', {
            width: video.width,
            height: video.height,
            fps: formatFrameRate(video.frameRate),
            codec: video.codec,
          })}
          {video.variableFrameRate && ` (${t('episode.variableFrameRate')})`}
        </dd>
        <dt>{t('episode.audio')}</dt>
        <dd>
          {audio
            ? t('episode.audioInfo', { rate: audio.sampleRate / 1000, channels: audio.channels, codec: audio.codec })
            : t('episode.noAudio')}
        </dd>
      </dl>
    </section>
  );
}
