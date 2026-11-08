import { useTranslation } from 'react-i18next';
import { keptLength } from '../../../shared/skips.ts';
import { openClip, setTool, useOpenClipId } from '../clip/state.ts';
import { exportClip, isExporting, useExport } from '../export/state.ts';
import { formatDuration } from '../format.ts';
import { seek } from '../player/playback.ts';
import { deleteClip } from '../project/clips.ts';
import { useProject } from '../project/store.ts';
import { ClipThumb } from './ClipThumb.tsx';

/**
 * The project's clips in the order they appear in the episode, each a card
 * with a picture from its start. On the episode screen the picture sits
 * beside the name and times; as a `strip` (beside an open clip) it sits
 * above them, and a last button leads to the transcript to make another.
 */
export function ClipList({ strip = false }: { strip?: boolean }) {
  const { t } = useTranslation();
  const clips = useProject((s) => s.project?.clips);
  const source = useProject((s) => s.project?.source);
  const exporting = useExport(isExporting);
  const openId = useOpenClipId();
  const sorted = [...(clips ?? [])].sort((a, b) => a.start - b.start);

  return (
    <section className={strip ? 'clip-list strip' : 'clip-list'}>
      <h2>{t('clips.title')}</h2>
      {sorted.length === 0 ? (
        <p className="dim">{t('clips.empty')}</p>
      ) : (
        <ul>
          {sorted.map((clip) => (
            <li key={clip.id} className={clip.id === openId ? 'open' : undefined} aria-current={clip.id === openId || undefined}>
              <button
                type="button"
                className="link name"
                onClick={() => {
                  openClip(clip.id);
                  seek(clip.start);
                }}
              >
                {source && <ClipThumb clip={clip} source={source} />}
                <span className="title">{clip.name || t('clips.untitled')}</span>
              </button>
              {strip ? (
                <span className="meta">{formatDuration(keptLength(clip))}</span>
              ) : (
                <span className="meta">
                  <span>{formatDuration(clip.start)}</span>
                  <span>{t('clips.lasts', { length: formatDuration(keptLength(clip)) })}</span>
                </span>
              )}
              <button
                type="button"
                className={strip ? 'link export' : 'export'}
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
      {strip && (
        <button type="button" className="new-clip" title={t('clips.newHelp')} onClick={() => setTool('text')}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M7 2v10M2 7h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          {t('clips.new')}
        </button>
      )}
    </section>
  );
}
