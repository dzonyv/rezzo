import { describe, expect, it } from 'vitest';
import { baseName, fileName, formatDuration, formatFrameRate } from './format.ts';

describe('format', () => {
  it('durations', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65.9)).toBe('1:05');
    expect(formatDuration(3725.4)).toBe('1:02:05');
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
