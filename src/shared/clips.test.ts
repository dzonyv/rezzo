import { describe, expect, it } from 'vitest';
import { clipFromWords, clipName, fitsInClip, moveEdge, rangeForWords } from './clips.ts';
import { workingFrameRate } from './frames.ts';
import { clipSchema, MAX_CLIP_SECONDS, type Source, type Word } from './project.ts';

const source = (frameRate: [number, number], duration = 600): Pick<Source, 'video' | 'duration'> => ({
  duration,
  video: { codec: 'h264', width: 1920, height: 1080, frameRate, variableFrameRate: false, colorSpace: null },
});

const words = (texts: string, start = 10): Word[] =>
  texts.split(' ').map((text, i) => ({ text, start: start + i * 0.5, end: start + i * 0.5 + 0.4, p: 0.9 }));

describe('frame rates', () => {
  it('keeps camera rates and maps odd ones to the nearest standard rate', () => {
    expect(workingFrameRate(source([25, 1]))).toEqual([25, 1]);
    expect(workingFrameRate(source([30000, 1001]))).toEqual([30000, 1001]);
    expect(workingFrameRate(source([1000, 1]))).toEqual([60, 1]);
    expect(workingFrameRate(source([15, 1]))).toEqual([24000, 1001]);
    expect(workingFrameRate(source([2997, 100]))).toEqual([30000, 1001]);
  });
});

describe('clips from words', () => {
  it('covers the words with a little room, on whole frames', () => {
    const range = rangeForWords(words('Dobro veče svima'), source([25, 1]));
    expect(range.start).toBeCloseTo(9.88); // 10 - 0.1, down to a frame
    expect(range.end).toBeCloseTo(11.6); // 11.4 + 0.2
    expect((range.start * 25) % 1).toBeCloseTo(0);
  });

  it('stays inside the source', () => {
    const range = rangeForWords(words('kraj', 599.7), source([25, 1], 600));
    expect(range.end).toBe(600);
    expect(rangeForWords(words('početak', 0.02), source([25, 1])).start).toBe(0);
  });

  it('names the clip after its first words', () => {
    expect(clipName(words('Dobro veče.'))).toBe('Dobro veče');
    expect(clipName(words('jedan dva tri četiri pet šest sedam'))).toBe('jedan dva tri četiri pet šest…');
  });

  it('makes a valid clip that starts in Follow', () => {
    const clip = clipFromWords(words('Dobro veče'), source([30, 1]), '6c1f0d6e-6a2b-4a7e-9d0e-3f1f5b2a9c11');
    expect(clipSchema.safeParse(clip).success).toBe(true);
    expect(clip.layers[0]!.layout).toEqual([{ t: clip.start, value: 'follow', ease: 'cut' }]);
  });

  it('knows when a selection is too long', () => {
    expect(fitsInClip({ start: 0, end: MAX_CLIP_SECONDS })).toBe(true);
    expect(fitsInClip({ start: 0, end: MAX_CLIP_SECONDS + 0.1 })).toBe(false);
  });
});

describe('trimming', () => {
  const s = source([25, 1], 100);

  it('moves an edge by whole frames', () => {
    expect(moveEdge({ start: 10, end: 20 }, 'start', -2, s)).toEqual({ start: 9.92, end: 20 });
    expect(moveEdge({ start: 10, end: 20 }, 'end', 2, s)).toEqual({ start: 10, end: 20.08 });
  });

  it('keeps the clip at least a frame long, inside the source and under the limit', () => {
    expect(moveEdge({ start: 10, end: 10.04 }, 'start', 5, s)).toEqual({ start: 10, end: 10.04 });
    expect(moveEdge({ start: 99, end: 100 }, 'end', 25, s).end).toBe(100);
    expect(moveEdge({ start: 0.08, end: 3 }, 'start', -25, s).start).toBe(0);
    const long = source([25, 1], 1000);
    expect(moveEdge({ start: 100, end: 100 + MAX_CLIP_SECONDS }, 'end', 25, long).end).toBe(100 + MAX_CLIP_SECONDS);
  });
});
