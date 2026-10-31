import { describe, expect, it } from 'vitest';
import { timeOfFrame, type FrameRate } from './frames.ts';
import {
  clipFrames, parseWorkingFileName, spanCovers, spanEnd, spanStart, workingFileName, workingFrameIndex, workingFrameTime, workingSpan,
} from './working.ts';

describe('working file spans', () => {
  it('reaches two seconds past both ends of the clip, on whole frames', () => {
    const span = workingSpan({ start: 10.04, end: 20 }, { duration: 600 }, [25, 1]);
    expect(span).toEqual({ first: 201, end: 550, rate: [25, 1] });
    expect(spanStart(span)).toBeCloseTo(8.04);
    expect(spanEnd(span)).toBe(22);
  });

  it('stays inside the source', () => {
    const span = workingSpan({ start: 1, end: 599.5 }, { duration: 600 }, [30, 1]);
    expect(span.first).toBe(0);
    expect(span.end).toBe(18000);
  });

  it('knows when a trimmed clip still fits', () => {
    const span = workingSpan({ start: 10, end: 20 }, { duration: 600 }, [25, 1]);
    expect(spanCovers(span, { start: 9, end: 21.5 })).toBe(true);
    expect(spanCovers(span, { start: 7.9, end: 20 })).toBe(false);
    expect(spanCovers(span, { start: 10, end: 22.1 })).toBe(false);
  });

  it('round-trips the cache name and ignores other versions', () => {
    const span = workingSpan({ start: 60, end: 120 }, { duration: 600 }, [30000, 1001]);
    expect(parseWorkingFileName(workingFileName(span))).toEqual(span);
    expect(parseWorkingFileName('1-2@30-1.v0.mp4')).toBeNull();
    expect(parseWorkingFileName('1-2@30-1.v1.part.mp4')).toBeNull();
  });
});

describe('frames of a clip in its working file', () => {
  const rates: FrameRate[] = [[25, 1], [30000, 1001], [30, 1]];

  it.each(rates)('maps frame times back to their own frame at %i/%i', (num, den) => {
    const rate: FrameRate = [num, den];
    const file = { start: timeOfFrame(1234, rate), frameRate: rate };
    for (let i = 0; i < 500; i++) {
      expect(workingFrameIndex(file, workingFrameTime(file, i))).toBe(i);
      expect(workingFrameIndex(file, timeOfFrame(1234 + i, rate))).toBe(i);
    }
  });

  it.each(rates)('covers every frame from the clip start up to, not including, its end at %i/%i', (num, den) => {
    const rate: FrameRate = [num, den];
    const file = { start: timeOfFrame(100, rate), frameRate: rate };
    const range = { start: timeOfFrame(160, rate), end: timeOfFrame(460, rate) };
    expect(clipFrames(file, range)).toEqual({ first: 60, count: 300 });
  });

  it('counts the frame on screen when a time falls between frames', () => {
    const file = { start: 10, frameRate: [25, 1] as FrameRate };
    expect(workingFrameIndex(file, 10.079)).toBe(1);
    expect(workingFrameIndex(file, 10.08)).toBe(2);
  });
});
