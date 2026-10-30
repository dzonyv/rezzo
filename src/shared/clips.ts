/** Making clips from transcript words, and changing their range. */
import { defaultVideoLayer } from './framing.ts';
import { fps, frameAt, timeOfFrame, workingFrameRate } from './frames.ts';
import { MAX_CLIP_SECONDS, type Clip, type Source, type Word } from './project.ts';

/** Room before the first word, so its start isn't clipped. */
export const LEAD_SECONDS = 0.1;
/** Room after the last word: DTW word ends run a little early on trailing sounds. */
export const TAIL_SECONDS = 0.2;

const NAME_WORDS = 6;
const NAME_CHARS = 48;

/** A short name from the first few words, without trailing punctuation. */
export function clipName(words: readonly Pick<Word, 'text'>[]): string {
  let name = words
    .slice(0, NAME_WORDS)
    .map((w) => w.text)
    .join(' ');
  if (name.length > NAME_CHARS) name = `${name.slice(0, NAME_CHARS).trimEnd()}…`;
  else if (words.length > NAME_WORDS) name = `${name}…`;
  return name.replace(/[,.;:!?]+(…?)$/, '$1');
}

/**
 * The range a clip of these words covers: a little before the first word
 * to a little after the last, on whole frames and inside the source.
 */
export function rangeForWords(words: readonly Pick<Word, 'start' | 'end'>[], source: Pick<Source, 'video' | 'duration'>): { start: number; end: number } {
  const first = words[0];
  const last = words.at(-1);
  if (!first || !last) throw new Error('no words');
  const rate = workingFrameRate(source);
  const lastFrame = Math.floor(source.duration * fps(rate));
  const start = Math.max(0, Math.floor((first.start - LEAD_SECONDS) * fps(rate) + 1e-9));
  const end = Math.min(lastFrame, Math.ceil((last.end + TAIL_SECONDS) * fps(rate) - 1e-9));
  return { start: timeOfFrame(start, rate), end: timeOfFrame(Math.max(end, start + 1), rate) };
}

export const clipLength = (range: { start: number; end: number }): number => range.end - range.start;

export const fitsInClip = (range: { start: number; end: number }): boolean => clipLength(range) <= MAX_CLIP_SECONDS + 1e-6;

export function clipFromWords(words: readonly Word[], source: Pick<Source, 'video' | 'duration'>, id: string = crypto.randomUUID()): Clip {
  const range = rangeForWords(words, source);
  return { id, name: clipName(words), ...range, layers: [defaultVideoLayer(range.start)] };
}

/**
 * Moves one edge of a clip by `frames` frames, keeping it inside the
 * source, at least a frame long and no longer than the limit.
 */
export function moveEdge(clip: Pick<Clip, 'start' | 'end'>, edge: 'start' | 'end', frames: number, source: Pick<Source, 'video' | 'duration'>): { start: number; end: number } {
  const rate = workingFrameRate(source);
  const lastFrame = Math.floor(source.duration * fps(rate));
  const maxFrames = Math.floor(MAX_CLIP_SECONDS * fps(rate) + 1e-9);
  let start = frameAt(clip.start, rate);
  let end = frameAt(clip.end, rate);
  if (edge === 'start') {
    start = Math.min(Math.max(0, end - maxFrames, start + frames), end - 1);
  } else {
    end = Math.max(Math.min(lastFrame, start + maxFrames, end + frames), start + 1);
  }
  return { start: timeOfFrame(start, rate), end: timeOfFrame(end, rate) };
}
