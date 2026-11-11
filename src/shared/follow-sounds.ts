/**
 * Sounds that go with a layer's entrance or exit (a pop as a picture pops
 * in, a whoosh as it slides out). Such a sound is an ordinary sound layer
 * with `follows` set; its start and end are worked out here from the layer
 * it follows, so the player, the export and the timeline need nothing new.
 * Every edit to a clip runs syncFollowers, so moving, trimming or
 * re-animating a layer takes its sounds along, and deleting it deletes them.
 */
import type { Asset } from './assets.ts';
import { fps, frameAt, timeOfFrame, type FrameRate } from './frames.ts';
import { exitSeconds, type ENTRANCES, type EXITS } from './motion.ts';
import { isPlaced, type Clip, type PlacedLayer, type SoundLayer } from './project.ts';
import { soundDuration } from './sound-mix.ts';
import type { FollowPart, SoundName } from './sounds.ts';

/** The sound offered first for each kind of entrance; none for a fade, which is quiet by nature. */
export const ENTRANCE_SOUND: Record<(typeof ENTRANCES)[number], SoundName | null> = {
  none: 'pop',
  fade: null,
  pop: 'pop',
  slide: 'whoosh',
  zoom: 'swish',
  bounce: 'pop-cartoon',
};

/** The sound offered first for each kind of exit. */
export const EXIT_SOUND: Record<(typeof EXITS)[number], SoundName | null> = {
  none: 'swish',
  fade: null,
  pop: 'pop',
  slide: 'whoosh',
  zoom: 'swish',
};

/** The sound offered first for a part of the layer's animation as it is now. */
export const suggestedSound = (layer: Pick<PlacedLayer, 'motion'>, part: FollowPart): SoundName | null =>
  part === 'in' ? ENTRANCE_SOUND[layer.motion.in.kind] : EXIT_SOUND[layer.motion.out.kind];

/** Where a sound that goes with `part` of the layer starts, before its shift: where the layer comes in, or where it starts going out. */
export const followAnchor = (layer: Pick<PlacedLayer, 'start' | 'end' | 'motion'>, part: FollowPart): number =>
  part === 'in' ? layer.start : layer.end - exitSeconds(layer);

/** The sound that goes with `part` of the layer, if it has one. */
export function followerOf(clip: Pick<Clip, 'layers'>, layerId: string, part: FollowPart): SoundLayer | null {
  for (const l of clip.layers) if (l.kind === 'sound' && l.follows?.layerId === layerId && l.follows.part === part) return l;
  return null;
}

/**
 * Brings the sounds that go with a layer up to date with it, in place:
 * each starts on the frame nearest its anchor plus its shift (not before
 * the clip) and lasts as long as its file plays from its offset, at least
 * a frame. A sound whose layer is gone is deleted with it, and so is a
 * second sound for the same part of a layer. A sound whose file isn't
 * among `assets` keeps its time. Works on a plain clip or an Immer draft.
 * Returns whether any sound was deleted.
 */
export function syncFollowers(clip: Clip, assets: readonly Asset[], rate: FrameRate): boolean {
  const placed = new Map(clip.layers.filter(isPlaced).map((l) => [l.id, l]));
  const taken = new Set<string>();
  const first = frameAt(clip.start, rate);
  let deleted = false;
  for (let i = 0; i < clip.layers.length; i++) {
    const sound = clip.layers[i]!;
    if (sound.kind !== 'sound' || !sound.follows) continue;
    const { layerId, part, shift } = sound.follows;
    const layer = placed.get(layerId);
    const key = `${layerId} ${part}`;
    if (!layer || taken.has(key)) {
      clip.layers.splice(i--, 1);
      deleted = true;
      continue;
    }
    taken.add(key);
    sound.loop = false;
    const duration = soundDuration(sound, assets);
    if (duration === null) continue;
    const from = Math.max(first, frameAt(followAnchor(layer, part) + shift, rate));
    // Up to the frame the sound ends in, so none of it is cut.
    const length = Math.max(1, Math.ceil(Math.max(0, duration - sound.offset) * fps(rate) - 1e-6));
    sound.start = timeOfFrame(from, rate);
    sound.end = timeOfFrame(from + length, rate);
  }
  return deleted;
}
