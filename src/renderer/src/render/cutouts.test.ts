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
    expect(compositor.cutoutKey).toMatch(/@5:/);
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
    expect(compositor.cutoutKey).toMatch(/@5:/);
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
  it('says a failure once, until something is found again', async () => {
    let fail = true;
    const { masks } = setUp((_p, width, height) => (fail ? Promise.reject(new Error('no model')) : Promise.resolve({ data: new Uint8Array(width * height), width, height })));
    const failed = vi.fn();
    masks.onError = failed;
    for (const t of [5, 6, 7]) masks.update(t, follow(0.35));
    await masks.settle().catch(() => {});
    await new Promise((r) => setTimeout(r));
    expect(failed).toHaveBeenCalledOnce();
    fail = false;
    masks.update(8, follow(0.35));
    await masks.settle();
    fail = true;
    masks.update(9, follow(0.35));
    await masks.settle().catch(() => {});
    await new Promise((r) => setTimeout(r));
    expect(failed).toHaveBeenCalledTimes(2);
  });

  it('looks again in a close crop rather than use what it found in the whole frame', async () => {
    const { masks, find } = setUp();
    const full: FrameRecipe = { layout: 'full', background: 'blur', draws: [{ src: { x: 0, y: 0, w: 1, h: 1 }, dst: { x: 0, y: 656, w: 1080, h: 608 } }] };
    masks.update(5, full);
    await masks.settle();
    masks.update(5, follow(0.35));
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('shares what it found with another renderer on the same working file', async () => {
    const preview = setUp();
    preview.masks.file = 'media://working/a.mp4';
    preview.masks.update(5, follow(0.35));
    await preview.masks.settle();
    const saving = setUp();
    saving.masks.file = 'media://working/a.mp4';
    saving.masks.update(5, follow(0.35));
    expect(saving.find).not.toHaveBeenCalled();
    expect(saving.compositor.cutoutKey).not.toBeNull();
    const other = setUp();
    other.masks.update(5, follow(0.35));
    expect(other.find).toHaveBeenCalledOnce();
  });
});
