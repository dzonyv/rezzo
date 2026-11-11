import { useTranslation } from 'react-i18next';
import { MAX_DUCK_DB, MIN_DUCK_DB } from '../../../shared/ducking.ts';
import { evenGainDb } from '../../../shared/loudness.ts';
import type { Clip, SoundLayer, Source } from '../../../shared/project.ts';
import { setClipEvenLoudness, setSoundDuck } from '../project/layers.ts';
import { projectStore, useProject } from '../project/store.ts';
import { useClipLoudness, useClipSpeech, type Measured } from '../render/loudness.ts';
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

/**
 * The switch for turning a sound down while someone talks, how far, and
 * while it's on, what it found: still looking, no speech, or speech that
 * can't be told from the rest (nothing is turned down then).
 */
export function DuckSpeech({ clip, layer }: { clip: Clip; layer: SoundLayer }) {
  const { t } = useTranslation();
  const store = projectStore.getState();
  const source = useProject((s) => s.project?.source ?? null);
  const ready = useClipPlayback((s) => s.status === 'ready');
  const speech = useClipSpeech(source, clip, ready, layer.duck.on);
  const status = !source?.audio ? 'noSound' : speech === undefined ? 'finding' : speech === null ? 'unclear' : speech.length === 0 ? 'noSpeech' : null;
  return (
    <div className="duck-speech">
      <label className="switch-row">
        {t('sounds.duck.title')}
        <input type="checkbox" role="switch" className="switch" checked={layer.duck.on} onChange={(e) => setSoundDuck(clip.id, layer.id, { on: e.target.checked })} />
      </label>
      {layer.duck.on && (
        <>
          <label className="layer-slider">
            <span>{t('sounds.duck.amount')}</span>
            <input
              type="range"
              min={MIN_DUCK_DB}
              max={MAX_DUCK_DB}
              step={1}
              value={layer.duck.db}
              onPointerDown={() => store.beginGesture('history.duck')}
              onPointerUp={() => store.endGesture()}
              onChange={(e) => setSoundDuck(clip.id, layer.id, { db: Number(e.target.value) })}
            />
            <output>{t('sounds.loudness.gain', { db: `−${layer.duck.db}` })}</output>
          </label>
          {status && (
            <p className="dim hint" role="status">
              {t(`sounds.duck.${status}`)}
            </p>
          )}
          <p className="dim hint">{t('sounds.duck.help')}</p>
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
