import { useTranslation } from 'react-i18next';
import { evenGainDb } from '../../../shared/loudness.ts';
import type { Clip, Source } from '../../../shared/project.ts';
import { setClipEvenLoudness } from '../project/layers.ts';
import { useClipLoudness, type Measured } from '../render/loudness.ts';
import { useClipPlayback } from './playback.ts';

/** A number of decibels as the panels show it, with a real minus sign. */
const decibels = (v: number) => v.toFixed(1).replace('-', '−');

/** What evening out does: from what loudness to what, and the gain; or why there's none. */
function LoudnessReadout({ measured }: { measured: Measured | undefined }) {
  const { t } = useTranslation();
  if (measured === undefined || measured === 'failed' || measured.lufs === null) {
    const why = measured === undefined ? 'measuring' : measured === 'failed' ? 'failed' : 'unmeasurable';
    return (
      <p className="loudness-readout" role="status">
        <span className="dim">{t(`sounds.loudness.${why}`)}</span>
      </p>
    );
  }
  const db = evenGainDb(measured);
  // A twentieth of a decibel either way is as good as nothing.
  const same = Math.abs(db) < 0.05;
  return (
    <p className="loudness-readout" role="status">
      <span>{t('sounds.loudness.change', { from: decibels(measured.lufs), to: decibels(measured.lufs + db) })}</span>
      <span className="gain-chip">{same ? t('sounds.loudness.same') : t('sounds.loudness.gain', { db: `${db > 0 ? '+' : '−'}${decibels(Math.abs(db))}` })}</span>
    </p>
  );
}

/** The switch for evening out loudness and, while it's on, what it does and a word of help. */
export function EvenLoudness({ on, onChange, measured, help }: { on: boolean; onChange: (on: boolean) => void; measured: Measured | undefined; help: string }) {
  const { t } = useTranslation();
  return (
    <div className="even-loudness">
      <label className="switch-row">
        {t('sounds.loudness.even')}
        <input type="checkbox" role="switch" className="switch" checked={on} onChange={(e) => onChange(e.target.checked)} />
      </label>
      {on && (
        <>
          <LoudnessReadout measured={measured} />
          <p className="dim hint">{help}</p>
        </>
      )}
    </div>
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
        <EvenLoudness on={clip.evenLoudness} onChange={(on) => setClipEvenLoudness(clip.id, on)} measured={measured} help={t('sounds.loudness.clipHelp')} />
      ) : (
        <p className="dim hint">{t('sounds.loudness.noSound')}</p>
      )}
    </section>
  );
}
