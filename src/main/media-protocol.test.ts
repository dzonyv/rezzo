import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ protocol: {} }));
const { parseRange } = await import('./media-protocol.ts');

describe('parseRange', () => {
  it('reads the usual forms', () => {
    expect(parseRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('clamps the end to the file', () => {
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('rejects what it cannot serve', () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange('bytes=1000-', 1000)).toBeNull();
    expect(parseRange('bytes=5-2', 1000)).toBeNull();
    expect(parseRange('bytes=-', 1000)).toBeNull();
    expect(parseRange('bytes=0-1,5-6', 1000)).toBeNull();
    expect(parseRange('items=0-1', 1000)).toBeNull();
  });
});
