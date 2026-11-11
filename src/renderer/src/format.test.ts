import { describe, expect, it } from 'vitest';
import { baseName, fileName, formatBytes, formatClipTime, formatDuration, formatFrameRate } from './format.ts';

describe('formatBytes', () => {
  it('uses the largest unit the size fills, written as the language writes numbers', () => {
    expect(formatBytes(512, 'en')).toBe('512 B');
    expect(formatBytes(7_400_000_000, 'en')).toBe('7.4 GB');
    expect(formatBytes(7_400_000_000, 'sr-Latn')).toBe('7,4 GB');
    expect(formatBytes(950_000_000, 'en')).toBe('950 MB');
    expect(formatBytes(1_000_000, 'en')).toBe('1 MB');
    // Just under a unit, rounded up: the next unit, not "1,000 MB".
    expect(formatBytes(999_960_000, 'en')).toBe('1 GB');
    expect(formatBytes(999_960, 'sr-Latn')).toBe('1 MB');
  });
});

describe('format', () => {
  it('durations', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65.9)).toBe('1:05');
    expect(formatDuration(3725.4)).toBe('1:02:05');
  });

  it('clip times', () => {
    expect(formatClipTime(0)).toBe('0:00.0');
    expect(formatClipTime(3.27)).toBe('0:03.2');
    expect(formatClipTime(65.04)).toBe('1:05.0');
    expect(formatClipTime(0.3)).toBe('0:00.3');
  });

  it('frame rates', () => {
    expect(formatFrameRate([30000, 1001])).toBe('29.97');
    expect(formatFrameRate([24000, 1001])).toBe('23.98');
    expect(formatFrameRate([25, 1])).toBe('25');
  });

  it('file names', () => {
    expect(fileName('D:\\Video\\Epizoda 12.mp4')).toBe('Epizoda 12.mp4');
    expect(baseName('D:\\Video\\Epizoda 12.final.mp4')).toBe('Epizoda 12.final');
    expect(baseName('/home/x/clip')).toBe('clip');
  });
});
