import { useTranslation } from 'react-i18next';
import type { Clip } from '../../../shared/project.ts';
import type { PauseOptions } from '../../../shared/skips.ts';
import { cutFoundPauses, findPauses, restoreAllSkips } from '../project/skips.ts';
import { currentPlayer, useClipPlayback } from './playback.ts';
import { setFoundPauses, setPauseOptions, useFoundPauses, usePauseOptions } from './state.ts';

const MIN_PAUSES = [0.3, 0.5, 0.8, 1.2];
const AIRS = [0.05, 0.1, 0.2];

/**
 * Takes pauses out of the clip. Nothing happens until asked: "Find pauses"
 * marks them on the timeline, where each can be switched off, and "Remove"
 * cuts what's left in one undo step.
 */
export function SilencePanel({ clip }: { clip: Clip }) {
  const { t } = useTranslation();
  const ready = useClipPlayback((s) => s.status === 'ready');
  const options = usePauseOptions();
  const found = useFoundPauses(clip.id);
  const canFind = ready && currentPlayer()?.hasAudio === true;
  const on = found?.filter((p) => p.on) ?? [];
  const seconds = on.reduce((sum, p) => sum + p.end - p.start, 0);

  const change = (patch: Partial<PauseOptions>) => {
    setPauseOptions(patch);
    if (found) findPauses(clip.id, { ...options, ...patch });
  };

  return (
    <div className="silence" role="group" aria-label={t('silence.title')}>
      <button type="button" disabled={!canFind} title={t(canFind ? 'silence.findHelp' : 'silence.noSound')} onClick={() => findPauses(clip.id, options)}>
        {t('silence.find')}
      </button>
      <label>
        {t('silence.minPause')}
        <select value={options.minPause} onChange={(e) => change({ minPause: Number(e.target.value) })}>
          {MIN_PAUSES.map((v) => (
            <option key={v} value={v}>
              {t('silence.seconds', { value: v })}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('silence.air')}
        <select value={options.air} onChange={(e) => change({ air: Number(e.target.value) })}>
          {AIRS.map((v) => (
            <option key={v} value={v}>
              {t('silence.seconds', { value: v })}
            </option>
          ))}
        </select>
      </label>
      {clip.skips.length > 0 && (
        <button type="button" onClick={() => restoreAllSkips(clip.id)}>
          {t('silence.restoreAll')}
        </button>
      )}
      {found && (
        <div className="silence-found" role="status">
          <span>{found.length === 0 ? t('silence.none') : t('silence.found', { count: on.length, seconds: seconds.toFixed(1) })}</span>
          {found.length > 0 && (
            <button type="button" className="primary" disabled={on.length === 0} onClick={() => cutFoundPauses(clip.id)}>
              {t('silence.remove')}
            </button>
          )}
          <button type="button" onClick={() => setFoundPauses(null)}>
            {t('silence.cancel')}
          </button>
        </div>
      )}
    </div>
  );
}
