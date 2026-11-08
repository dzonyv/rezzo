import { useEffect, useState } from 'react';
import { valueAt } from '../../../shared/framing.ts';
import { videoLayerOf, type Clip, type Source } from '../../../shared/project.ts';
import type { ThumbnailSize } from '../../../shared/worker-api.ts';
import { keptPieces } from '../../../shared/skips.ts';
import { useClipPlayback } from '../clip/playback.ts';
import { useOpenClipId } from '../clip/state.ts';

/** Thumbnails already asked for, by source, time and size; each is made once. */
const thumbnails = new Map<string, Promise<string>>();

function thumbnailOf(source: Source, time: number, size: ThumbnailSize): Promise<string> {
  const key = `${source.fingerprint}:${Math.round(time * 1000)}:${size}`;
  let url = thumbnails.get(key);
  if (!url) {
    url = window.rezzo.invoke('episode:thumbnail', source, time, size);
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
export function ClipThumb({ clip, source, size = 'card' }: { clip: Clip; source: Source; size?: ThumbnailSize }) {
  // On a half-second grid, so trimming the start a step at a time keeps the same picture.
  const time = Math.ceil((keptPieces(clip)[0]?.start ?? clip.start) * 2) / 2;
  const [url, setUrl] = useState<string | null>(null);
  // The open clip's working file comes first: both are made by FFmpeg in the same worker.
  // With no clip open (the episode screen) nothing is being made, whatever the status last said.
  const clipOpen = useOpenClipId() !== null;
  const preparing = useClipPlayback((s) => s.status === 'preparing') && clipOpen;
  useEffect(() => {
    if (preparing) return;
    let current = true;
    thumbnailOf(source, time, size).then(
      (u) => current && setUrl(u),
      () => current && setUrl(null),
    );
    return () => {
      current = false;
    };
  }, [source, time, size, preparing]);

  const video = videoLayerOf(clip);
  const layout = valueAt(video.layout, time);
  const x = layout === 'follow' ? valueAt(video.follow, time).x : 0.5;
  return (
    <span className="thumb" aria-hidden="true">
      {url && <img src={url} alt="" className={layout === 'full' ? 'whole' : undefined} style={{ objectPosition: `${x * 100}% 50%` }} />}
    </span>
  );
}
