import { describe, expect, it } from 'vitest';
import { parseWorkingFileName, spanCovers, spanEnd, spanStart, workingFileName, workingSpan } from './working.ts';

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
