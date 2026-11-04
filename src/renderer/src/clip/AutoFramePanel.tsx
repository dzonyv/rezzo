import { useTranslation } from 'react-i18next';
import { shotIndexAt } from '../../../shared/analysis.ts';
import { FRAME_WIDTHS, SPEAKER_CHANGES, type FrameWidth, type SpeakerChange } from '../../../shared/autoframe.ts';
import type { Clip } from '../../../shared/project.ts';
import type { Span } from '../../../shared/voices.ts';
import { useAnalysis } from '../analysis/store.ts';
import { applyAutoFrame } from '../project/framing.ts';
import { useVoices } from '../project/voices.ts';
import { useStretches } from './speakers.ts';
import { setFrameOptions, useFrameOptions } from './state.ts';

/**
 * Frames the whole clip, or the shot at the playhead, from who talks. The
 * result is plain keyframes and layouts, in one undo step; after correcting
 * who talks, "This shot" redoes just that part and leaves the rest alone.
 */
export function AutoFramePanel({ clip, time }: { clip: Clip; time: number }) {
  const { t } = useTranslation();
  const analysis = useAnalysis((s) => s.analysis);
  const stretches = useStretches();
  // Without its voices the clip would come out as Split wherever there are two people.
  const voicesComing = useVoices((s) => s.status === 'running' && !s.voices);
  const options = useFrameOptions();
  const shot = analysis?.shots[shotIndexAt(analysis.shots, time)];
  const ready = shot !== undefined && !voicesComing;
  const apply = (range: Span) => analysis && applyAutoFrame(clip.id, analysis, stretches, range, options);

  return (
    <div className="auto-frame" role="group" aria-label={t('autoFrame.title')}>
      <button type="button" disabled={!ready} title={t(ready ? 'autoFrame.buttonHelp' : 'autoFrame.waiting')} onClick={() => apply(clip)}>
        {t('autoFrame.button')}
      </button>
      <button type="button" disabled={!ready} title={t(ready ? 'autoFrame.shotHelp' : 'autoFrame.waiting')} onClick={() => shot && apply(shot)}>
        {t('autoFrame.shot')}
      </button>
      <label>
        {t('autoFrame.width')}
        <select value={options.width} onChange={(e) => setFrameOptions({ width: e.target.value as FrameWidth })}>
          {FRAME_WIDTHS.map((w) => (
            <option key={w} value={w}>
              {t(`autoFrame.widths.${w}`)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('autoFrame.change')}
        <select value={options.change} onChange={(e) => setFrameOptions({ change: e.target.value as SpeakerChange })}>
          {SPEAKER_CHANGES.map((c) => (
            <option key={c} value={c}>
              {t(`autoFrame.changes.${c}`)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
