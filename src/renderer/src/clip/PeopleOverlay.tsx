import { useTranslation } from 'react-i18next';
import { seatBoxAt, shotIndexAt } from '../../../shared/analysis.ts';
import { frameRecipe, OUTPUT, type Size } from '../../../shared/framing.ts';
import type { Box } from '../../../shared/heads.ts';
import type { VideoLayer } from '../../../shared/project.ts';
import { clickedStretch, isPicked, stretchAt } from '../../../shared/speakers.ts';
import { voiceAt } from '../../../shared/voices.ts';
import { useAnalysis } from '../analysis/store.ts';
import { useHeardVoices } from '../project/voices.ts';
import { voiceColor, voiceLabel } from '../voice-colors.ts';
import { sayWhoTalks } from './say-who-talks.ts';
import { useStretches } from './speakers.ts';

interface Props {
  layer: VideoLayer;
  /** Source seconds of the frame on screen. */
  time: number;
  sourceSize: Size | null;
}

/**
 * The heads the analysis found in this shot, drawn where they land in the
 * 9:16 picture: each seat's box goes through the same framing as the
 * picture, once for every part of the output that shows it. The one being
 * looked at has the colour and name of the voice talking now, which in a
 * close-up can be someone else's: that's how to spot it. With several people
 * in the shot, clicking one says they're the one talking; this works during
 * playback, so corrections can be made while listening.
 */
export function PeopleOverlay({ layer, time, sourceSize }: Props) {
  const { t } = useTranslation();
  const analysis = useAnalysis((s) => s.analysis);
  const stretches = useStretches();
  const heard = useHeardVoices();
  if (!analysis || !sourceSize || analysis.shots.length === 0) return null;

  const shot = shotIndexAt(analysis.shots, time);
  const seats = analysis.seats.filter((s) => s.shot === shot);
  const stretch = stretchAt(stretches, time);
  const clicked = clickedStretch(stretches, time);
  const target = stretch?.target.kind === 'seat' ? stretch.target : null;
  const talkingNow = heard ? voiceAt(heard.turns, time) : null;
  const voice = heard?.voices.find((v) => v.id === talkingNow);
  const { draws } = frameRecipe(layer, time, sourceSize);
  // Analysis boxes are in the working file's pixels; the recipe works in 0..1 of the source.
  const toUnit = (b: Box) => ({ x: b.x / analysis.width, y: b.y / analysis.height, w: b.w / analysis.width, h: b.h / analysis.height });

  return (
    <div className="people-overlay">
      {seats.flatMap((seat, n) => {
        const box = toUnit(seatBoxAt(seat, time));
        const talking = target?.seat === seat.id;
        const picked = clicked !== null && isPicked(clicked, seat.id);
        const label = talking && voice ? voiceLabel(t, voice) : t('analysis.person', { n: n + 1 });
        return draws.map((d, i) => {
          const x0 = Math.max(box.x, d.src.x);
          const y0 = Math.max(box.y, d.src.y);
          const x1 = Math.min(box.x + box.w, d.src.x + d.src.w);
          const y1 = Math.min(box.y + box.h, d.src.y + d.src.h);
          if (x1 <= x0 || y1 <= y0) return [];
          const ox = (x: number) => d.dst.x + ((x - d.src.x) / d.src.w) * d.dst.w;
          const oy = (y: number) => d.dst.y + ((y - d.src.y) / d.src.h) * d.dst.h;
          return [
            <button
              key={`${seat.id}-${i}`}
              type="button"
              className={`person${talking ? ' talking' : ''}`}
              aria-pressed={talking}
              disabled={seats.length < 2}
              title={seats.length < 2 ? undefined : t(picked ? 'speakers.unpick' : 'speakers.pick')}
              style={{
                left: `${(ox(x0) / OUTPUT.width) * 100}%`,
                top: `${(oy(y0) / OUTPUT.height) * 100}%`,
                width: `${((ox(x1) - ox(x0)) / OUTPUT.width) * 100}%`,
                height: `${((oy(y1) - oy(y0)) / OUTPUT.height) * 100}%`,
                ...(talking && voice ? ({ '--person': voiceColor(voice.id) } as React.CSSProperties) : {}),
              }}
              onClick={() => clicked && sayWhoTalks(clicked, seat, analysis, time)}
            >
              <span>{label}</span>
            </button>,
          ];
        });
      })}
    </div>
  );
}
