import { describe, expect, it, vi } from 'vitest';
import type { FrameRecipe } from '../../../shared/framing.ts';
import type { Compositor } from './compositor.ts';
import { CutoutMasks, type FindPeople } from './cutouts.ts';

/** Just what CutoutMasks uses of a compositor. */
function fakeCompositor() {
  let key: string | null = null;
  return {
    sourceSize: { width: 1920, height: 1080 },
    get cutoutKey() {
      return key;
    },
    setCutoutMask: vi.fn((mask: { key: string } | null) => (key = mask?.key ?? null)),
    readSource: vi.fn((_rect: unknown, w: number, h: number) => new Uint8ClampedArray(w * h * 4)),
  };
}

const follow = (x: number): FrameRecipe => ({ layout: 'follow', background: null, draws: [{ src: { x, y: 0, w: 0.3, h: 1 }, dst: { x: 0, y: 0, w: 1080, h: 1920 } }] });

function setUp(find: FindPeople = (_p, width, height) => Promise.resolve({ data: new Uint8Array(width * height), width, height })) {
  const compositor = fakeCompositor();
  const looker = vi.fn(find);
  const masks = new CutoutMasks(compositor as unknown as Compositor, looker);
  const found = vi.fn();
  masks.onFound = found;
  return { compositor, masks, found, find: looker };
}

describe('cutout masks', () => {
  it('looks once for a moment and framing, and hands the people over when found', async () => {
    const { compositor, masks, found, find } = setUp();
    masks.update(5, follow(0.35));
    masks.update(5, follow(0.35));
    expect(find).toHaveBeenCalledTimes(1);
    expect(compositor.cutoutKey).toBeNull();
    expect(await masks.settle()).toBe(true);
    expect(found).toHaveBeenCalledOnce();
    masks.update(5, follow(0.35));
    expect(compositor.cutoutKey).toMatch(/^5:/);
    expect(await masks.settle()).toBe(false);
  });

  it('keeps what it found for a small framing change, and looks again for another moment', async () => {
    const { compositor, masks, find } = setUp();
    masks.update(5, follow(0.35));
    await masks.settle();
    masks.update(5, follow(0.352));
    expect(find).toHaveBeenCalledTimes(1);
    masks.update(6, follow(0.35));
    expect(find).toHaveBeenCalledTimes(2);
    // People from the other moment would be in the wrong place.
    expect(compositor.cutoutKey).toBeNull();
    await masks.settle();
    masks.update(5, follow(0.35));
    expect(compositor.cutoutKey).toMatch(/^5:/);
  });

  it("says when it fails, and doesn't try that picture again", async () => {
    const { masks, find } = setUp(() => Promise.reject(new Error('no GPU')));
    const failed = vi.fn();
    masks.onError = failed;
    masks.update(5, follow(0.35));
    await expect(masks.settle()).rejects.toThrow('no GPU');
    await Promise.resolve();
    expect(failed).toHaveBeenCalledOnce();
    masks.update(5, follow(0.35));
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('reports looking while anything is being looked for', async () => {
    const { masks } = setUp();
    const looking = vi.fn();
    masks.onLooking = looking;
    masks.update(5, follow(0.35));
    masks.update(6, follow(0.35));
    await masks.settle();
    await new Promise((r) => setTimeout(r));
    expect(looking.mock.calls).toEqual([[true], [false]]);
  });
});
