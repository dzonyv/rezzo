/**
 * A clip's cover: the picture a platform shows before the clip plays. It's
 * drawn as a clip of its own held at one moment (coverClip), so the
 * compositor, the scene and the handles over the preview work on it as
 * they do on the clip, and the saved PNG looks exactly like the editor.
 */
import { valueAt } from './framing.ts';
import type { Motion } from './motion.ts';
import { videoLayerOf, type Animated, type Clip, type Cover, type CoverLayer, type Layer, type VideoLayer } from './project.ts';
import { nextKept } from './skips.ts';

/** The formats a cover is saved in. */
export const COVER_FORMATS = ['png', 'jpg'] as const;
export type CoverFormat = (typeof COVER_FORMATS)[number];

/** A JPG cover is at most this big: the usual limit for an uploaded thumbnail (YouTube's). */
export const MAX_JPG_BYTES = 2 * 1024 * 1024;

/** Most words a title taken from the transcript has: more don't fit on a cover. */
export const MAX_TITLE_WORDS = 20;

/**
 * A cover title from words of the transcript: their text on one line,
 * without the comma or full stop the last one ends in (a question or an
 * exclamation stays).
 */
export function coverTitleOf(words: readonly { text: string }[]): string {
  return words
    .map((w) => w.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:…]+$/u, '');
}

/** Cover layers don't move: the cover is one moment. */
export const NO_MOTION: Motion = {
  in: { kind: 'none', direction: 'left', seconds: 0.3 },
  out: { kind: 'none', direction: 'right', seconds: 0.3 },
  loop: { kind: 'none', direction: 'left', strength: 0.5 },
};

/**
 * `t` moved to a moment the clip plays: inside it, and past a stretch it
 * leaves out. Covers keep their moment when the clip is trimmed or cut,
 * so the moment is checked where it's used.
 */
export function keptTime(clip: Pick<Clip, 'start' | 'end' | 'skips'>, t: number): number {
  const inside = Math.min(Math.max(t, clip.start), clip.end - 1e-3);
  return nextKept(clip, inside) ?? clip.start;
}

/** The clip's cover as it is, or the one it starts with: its first moment, the clip's framing, nothing over it. */
export function coverOf(clip: Pick<Clip, 'start' | 'end' | 'skips' | 'cover'>): Cover {
  const cover = clip.cover ?? { time: clip.start, video: null, layers: [] };
  return { ...cover, time: keptTime(clip, cover.time) };
}

/** The clip's framing at `t` as framing of the cover's own: one key on each track. */
export function coverFraming(video: VideoLayer, t: number, id: string = crypto.randomUUID()): VideoLayer {
  const one = <T>(keys: Animated<T>): Animated<T> => [{ t, value: valueAt(keys, t), ease: 'cut' }];
  return {
    id,
    kind: 'video',
    layout: one(video.layout),
    follow: one(video.follow),
    splitTop: one(video.splitTop),
    splitBottom: one(video.splitBottom),
    full: one(video.full),
  };
}

/** A cover layer as the clip's scene draws it: up for the whole clip, not moving. */
const shownLayer = (layer: CoverLayer, clip: Pick<Clip, 'start' | 'end'>): CoverLayer => ({ ...layer, start: clip.start, end: clip.end, motion: NO_MOTION });

/**
 * The cover as a clip to draw at coverOf(clip).time: the video, framed as
 * the cover says, and the cover's layers over it. No captions, effects or
 * sounds. It keeps the clip's id, range and cuts, so the player that shows
 * the clip shows the cover too.
 */
export function coverClip(clip: Clip): Clip {
  const cover = coverOf(clip);
  const layers: Layer[] = [cover.video ?? videoLayerOf(clip), ...cover.layers.map((l) => shownLayer(l, clip))];
  return { ...clip, layers };
}
