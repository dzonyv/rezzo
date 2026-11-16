import { describe, expect, it } from 'vitest';
import { OUTPUT } from './framing.ts';
import { clearArea, gridCrop, PLATFORMS, SAFE_ZONES } from './safe-zones.ts';

describe('safe zones', () => {
  it('leaves a clear part inside the picture on every platform', () => {
    for (const p of PLATFORMS) {
      const m = SAFE_ZONES[p];
      expect(m.left + m.right).toBeLessThan(OUTPUT.width / 2);
      expect(m.top + m.bottom).toBeLessThan(OUTPUT.height / 2);
      const b = clearArea(p);
      expect(b.x).toBeGreaterThan(0);
      expect(b.x + b.w).toBeLessThan(1);
      expect(b.y + b.h).toBeLessThan(1);
    }
    expect(clearArea('tiktok')).toEqual({ x: 60 / 1080, y: 130 / 1920, w: 880 / 1080, h: 1350 / 1920 });
  });

  it("cuts Instagram's grid to 3:4 from the middle", () => {
    expect(gridCrop()).toEqual({ x: 0, y: 240 / 1920, w: 1, h: 1440 / 1920 });
  });
});
