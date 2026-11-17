import { describe, expect, it } from 'vitest';
import { covers, maskRegion, maskSize, MASK_LONG_SIDE } from './cutout.ts';

describe('cutout', () => {
  it('looks a little past what the framing shows, snapped out to sixteenths', () => {
    // A Follow crop in the middle of a 16:9 frame.
    const region = maskRegion([{ x: 0.35, y: 0, w: 0.3, h: 1 }]);
    expect(region).toEqual({ x: 0.3125, y: 0, w: 0.375, h: 1 });
    expect(covers(region, { x: 0.35, y: 0, w: 0.3, h: 1 })).toBe(true);
  });

  it('covers both halves of a split in one region', () => {
    const region = maskRegion([
      { x: 0.05, y: 0.1, w: 0.3, h: 0.4 },
      { x: 0.6, y: 0.2, w: 0.3, h: 0.4 },
    ]);
    expect(covers(region, { x: 0.05, y: 0.1, w: 0.85, h: 0.5 })).toBe(true);
    expect(region.x).toBeGreaterThanOrEqual(0);
    expect(region.x + region.w).toBeLessThanOrEqual(1);
  });

  it('gives a small framing change the same region, so nobody is looked for again', () => {
    expect(maskRegion([{ x: 0.35, y: 0, w: 0.3, h: 1 }])).toEqual(maskRegion([{ x: 0.352, y: 0, w: 0.3, h: 1 }]));
  });

  it("tells whether a region holds another", () => {
    const outer = { x: 0.25, y: 0, w: 0.5, h: 1 };
    expect(covers(outer, { x: 0.3, y: 0.1, w: 0.4, h: 0.8 })).toBe(true);
    expect(covers(outer, { x: 0.2, y: 0.1, w: 0.4, h: 0.8 })).toBe(false);
  });

  it('hands the segmenter the region at most MASK_LONG_SIDE long, never enlarged', () => {
    expect(maskSize({ x: 0, y: 0, w: 1, h: 1 }, { width: 3840, height: 2160 })).toEqual({ width: MASK_LONG_SIDE, height: 576 });
    expect(maskSize({ x: 0.25, y: 0, w: 0.5, h: 1 }, { width: 640, height: 360 })).toEqual({ width: 320, height: 360 });
  });
});
