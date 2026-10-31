import { useTranslation } from 'react-i18next';
import { openClip, useOpenClipId } from '../clip/state.ts';
import { exportClip, isExporting, useExport } from '../export/state.ts';
import { formatDuration } from '../format.ts';
import { seek } from '../player/playback.ts';
import { deleteClip } from '../project/clips.ts';
import { useProject } from '../project/store.ts';

/** The project's clips in the order they appear in the episode. */
export function ClipList() {
  const { t } = useTranslation();
  const clips = useProject((s) => s.project?.clips);
  const source = useProject((s) => s.project?.source);
  const exporting = useExport(isExporting);
  const openId = useOpenClipId();
  const sorted = [...(clips ?? [])].sort((a, b) => a.start - b.start);

  return (
    <section className="clip-list">
      <h2>{t('clips.title')}</h2>
      {sorted.length === 0 ? (
        <p className="dim">{t('clips.empty')}</p>
      ) : (
        <ul>
          {sorted.map((clip) => (
            <li key={clip.id} className={clip.id === openId ? 'open' : undefined}>
              <button
                type="button"
                className="link name"
                onClick={() => {
                  openClip(clip.id);
                  seek(clip.start);
                }}
              >
                {clip.name || t('clips.untitled')}
              </button>
              <span className="meta">
                {t('clips.length', { start: formatDuration(clip.start), length: formatDuration(clip.end - clip.start) })}
              </span>
              <button
                type="button"
                className="link"
                title={t('export.buttonHelp')}
                disabled={exporting || !source}
                onClick={() => source && void exportClip(clip, source)}
              >
                {t('export.button')}
              </button>
              <button
                type="button"
                className="icon"
                aria-label={t('clips.delete')}
                title={t('clips.delete')}
                onClick={() => deleteClip(clip.id)}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
