import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { evenGainDb } from '../../../shared/loudness.ts';
import type { Clip, Source } from '../../../shared/project.ts';
import { setClipEvenLoudness } from '../project/layers.ts';
import { useClipLoudness, type Measured } from '../render/loudness.ts';
import { useClipPlayback } from './playback.ts';

/** A number of decibels as the panels show it, with a real minus sign. */
const decibels = (v: number) => v.toFixed(1).replace('-', '−');

/** What evening out found and does: the measured loudness and the gain, or why there's none. */
export function LoudnessReadout({ measured }: { measured: Measured | undefined }) {
  const { t } = useTranslation();
  // Each part stays on one line; a narrow panel wraps between them.
  let parts: string[];
  if (measured === undefined) parts = [t('sounds.loudness.measuring')];
  else if (measured === 'failed') parts = [t('sounds.loudness.failed')];
  else if (measured.lufs === null) parts = [t('sounds.loudness.unmeasurable')];
  else {
    const db = evenGainDb(measured);
    // A tenth of a decibel either way is as good as nothing.
    const gain =
      Math.abs(db) < 0.05
        ? t('sounds.loudness.same')
        : t(db > 0 ? 'sounds.loudness.up' : 'sounds.loudness.down', { db: `${db > 0 ? '+' : '−'}${decibels(Math.abs(db))}` });
    parts = [t('sounds.loudness.measured', { lufs: decibels(measured.lufs) }), gain];
  }
  return (
    <p className="loudness-readout" role="status">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && ' · '}
          <span>{part}</span>
        </Fragment>
      ))}
    </p>
  );
}

/** The clip's own sound: whether its loudness is evened out, and by how much. */
export function ClipLoudness({ clip, source }: { clip: Clip; source: Source }) {
  const { t } = useTranslation();
  const ready = useClipPlayback((s) => s.status === 'ready');
  const measured = useClipLoudness(source, clip, ready);
  return (
    <section className="clip-loudness" aria-label={t('sounds.loudness.clipTitle')}>
      <h3>{t('sounds.loudness.clipTitle')}</h3>
      {source.audio ? (
        <>
          <label className="layer-check">
            <input type="checkbox" checked={clip.evenLoudness} onChange={(e) => setClipEvenLoudness(clip.id, e.target.checked)} />
            {t('sounds.loudness.even')}
          </label>
          {clip.evenLoudness && <LoudnessReadout measured={measured} />}
          <p className="dim hint">{t('sounds.loudness.clipHelp')}</p>
        </>
      ) : (
        <p className="dim hint">{t('sounds.loudness.noSound')}</p>
      )}
    </section>
  );
}
