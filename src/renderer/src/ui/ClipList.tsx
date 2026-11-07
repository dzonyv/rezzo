import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { valueAt } from '../../../shared/framing.ts';
import { videoLayerOf, type Clip, type Source } from '../../../shared/project.ts';
import { keptLength, keptPieces } from '../../../shared/skips.ts';
import { useClipPlayback } from '../clip/playback.ts';
import { openClip, setTool, useOpenClipId } from '../clip/state.ts';
import { exportClip, isExporting, useExport } from '../export/state.ts';
import { formatDuration } from '../format.ts';
import { seek } from '../player/playback.ts';
import { deleteClip } from '../project/clips.ts';
import { useProject } from '../project/store.ts';

/**
 * The project's clips in the order they appear in the episode. As a
 * `strip` (beside an open clip) each one is a card with a picture from its
 * start, and a last button leads to the transcript to make another.
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
                {strip && source && <ClipThumb clip={clip} source={source} />}
                <span className="title">{clip.name || t('clips.untitled')}</span>
              </button>
              <span className="meta">
                {strip ? formatDuration(keptLength(clip)) : t('clips.length', { start: formatDuration(clip.start), length: formatDuration(keptLength(clip)) })}
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

/** Thumbnails already asked for, by source and time; each is made once. */
const thumbnails = new Map<string, Promise<string>>();

function thumbnailOf(source: Source, time: number): Promise<string> {
  const key = `${source.fingerprint}:${Math.round(time * 1000)}`;
  let url = thumbnails.get(key);
  if (!url) {
    url = window.rezzo.invoke('episode:thumbnail', source, time);
    thumbnails.set(key, url);
    // One that failed (a moved source) is asked for again next time.
    url.catch(() => thumbnails.delete(key));
  }
  return url;
}

/**
 * A clip's picture: the source at the clip's first kept moment, slid
 * sideways to where its Follow crop looks, so it shows roughly who's in
 * the clip. Full frame shows the whole picture.
 */
function ClipThumb({ clip, source }: { clip: Clip; source: Source }) {
  // On a half-second grid, so trimming the start a step at a time keeps the same picture.
  const time = Math.ceil((keptPieces(clip)[0]?.start ?? clip.start) * 2) / 2;
  const [url, setUrl] = useState<string | null>(null);
  // The open clip's working file comes first: both are made by FFmpeg in the same worker.
  const preparing = useClipPlayback((s) => s.status === 'preparing');
  useEffect(() => {
    if (preparing) return;
    let current = true;
    thumbnailOf(source, time).then(
      (u) => current && setUrl(u),
      () => current && setUrl(null),
    );
    return () => {
      current = false;
    };
  }, [source, time, preparing]);

  const video = videoLayerOf(clip);
  const layout = valueAt(video.layout, time);
  const x = layout === 'follow' ? valueAt(video.follow, time).x : 0.5;
  return (
    <span className="thumb" aria-hidden="true">
      {url && <img src={url} alt="" className={layout === 'full' ? 'whole' : undefined} style={{ objectPosition: `${x * 100}% 50%` }} />}
    </span>
  );
}
