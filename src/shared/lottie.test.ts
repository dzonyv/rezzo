import { describe, expect, it } from 'vitest';
import { lottieFrameAt, lottieInfo, lottieRenderSize, MAX_LOTTIE_SIDE } from './lottie.ts';

const animation = { v: '5.7.4', fr: 30, ip: 0, op: 60, w: 200, h: 100, layers: [], assets: [] };

describe('Lottie metadata', () => {
  it('reads the size, frame rate and length', () => {
    expect(lottieInfo(animation)).toEqual({ width: 200, height: 100, frameRate: 30, frames: 60 });
    expect(lottieInfo({ ...animation, ip: 10, op: 25.5, fr: 29.97 })).toEqual({ width: 200, height: 100, frameRate: 29.97, frames: 15.5 });
  });

  it('rejects JSON that is not an animation', () => {
    expect(lottieInfo(null)).toBeNull();
    expect(lottieInfo([])).toBeNull();
    expect(lottieInfo({ ...animation, v: undefined })).toBeNull();
    expect(lottieInfo({ ...animation, fr: 0 })).toBeNull();
    expect(lottieInfo({ ...animation, op: 0 })).toBeNull();
    expect(lottieInfo({ ...animation, w: -1 })).toBeNull();
    expect(lottieInfo({ ...animation, layers: undefined })).toBeNull();
  });

  it('refuses images kept beside the file, but not embedded ones or ones in a package', () => {
    const external = { ...animation, assets: [{ id: 'i', u: 'images/', p: 'img_0.png', e: 0 }] };
    expect(lottieInfo(external)).toBe('external-images');
    expect(lottieInfo(external, { packaged: true })).toMatchObject({ frames: 60 });
    expect(lottieInfo({ ...animation, assets: [{ id: 'i', p: 'data:image/png;base64,AAAA', e: 1 }] })).toMatchObject({ frames: 60 });
    // A precomposition is an asset with layers, not a file.
    expect(lottieInfo({ ...animation, assets: [{ id: 'comp_0', layers: [] }] })).toMatchObject({ frames: 60 });
  });
});

describe('Lottie timing', () => {
  const info = { frameRate: 30, frames: 60 };

  it('plays from its first frame at the layer start, at its speed', () => {
    expect(lottieFrameAt({ start: 2, speed: 1, loop: false }, info, 2)).toBe(0);
    expect(lottieFrameAt({ start: 2, speed: 1, loop: false }, info, 1)).toBe(0);
    expect(lottieFrameAt({ start: 2, speed: 1, loop: false }, info, 2.5)).toBeCloseTo(15);
    expect(lottieFrameAt({ start: 2, speed: 2, loop: false }, info, 2.5)).toBeCloseTo(30);
  });

  it('holds its last frame, or starts over when it loops', () => {
    expect(lottieFrameAt({ start: 0, speed: 1, loop: false }, info, 5)).toBe(59);
    expect(lottieFrameAt({ start: 0, speed: 1, loop: true }, info, 2.5)).toBeCloseTo(15);
  });
});

describe('Lottie render size', () => {
  it('renders at least as large as drawn, in steps', () => {
    const size = lottieRenderSize({ width: 200, height: 100 }, 648);
    expect(size.width).toBeGreaterThanOrEqual(648);
    expect(size.width).toBeLessThan(648 * 1.2);
    expect(Math.abs(size.height - size.width / 2)).toBeLessThanOrEqual(1);
    // A small change on screen keeps the same size.
    expect(lottieRenderSize({ width: 200, height: 100 }, 640)).toEqual(size);
  });

  it('keeps within the largest size, and above the smallest', () => {
    expect(lottieRenderSize({ width: 512, height: 512 }, 10_000)).toEqual({ width: MAX_LOTTIE_SIDE, height: MAX_LOTTIE_SIDE });
    expect(lottieRenderSize({ width: 512, height: 512 }, 1).width).toBeGreaterThanOrEqual(16);
  });
});
