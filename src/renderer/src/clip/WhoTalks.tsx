import { useTranslation } from 'react-i18next';
import { shotIndexAt } from '../../../shared/analysis.ts';
import { clickedStretch, isPicked, stretchAt } from '../../../shared/speakers.ts';
import { useAnalysis } from '../analysis/store.ts';
import { sayWhoTalks } from './say-who-talks.ts';
import { useStretches } from './speakers.ts';

/**
 * Who is being looked at now and why, with a button for each person in a
 * shot with several: in Follow the crop often leaves one of them out of the
 * picture, where they can't be clicked.
 */
export function WhoTalks({ time }: { time: number }) {
  const { t } = useTranslation();
  const analysis = useAnalysis((s) => s.analysis);
  const stretches = useStretches();
  const stretch = stretchAt(stretches, time);
  const clicked = clickedStretch(stretches, time);
  if (!analysis || !stretch || !clicked) return null;

  const { target } = stretch;
  const shot = shotIndexAt(analysis.shots, time);
  const seats = analysis.seats.filter((s) => s.shot === shot);
  return (
    <div className="who-talks" role="group" aria-label={t('speakers.title')}>
      {seats.length > 1 &&
        seats.map((seat, n) => (
          <button
            key={seat.id}
            type="button"
            aria-pressed={target.kind === 'seat' && target.seat === seat.id}
            title={t(isPicked(clicked, seat.id) ? 'speakers.unpick' : 'speakers.pick')}
            onClick={() => sayWhoTalks(clicked, seat, analysis, time)}
          >
            {t('analysis.person', { n: n + 1 })}
          </button>
        ))}
      <span className="dim">{t(`speakers.why.${target.kind === 'seat' ? target.why : target.kind}`)}</span>
    </div>
  );
}
