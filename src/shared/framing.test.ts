import { describe, expect, it } from 'vitest';
import type { FrameRate } from './frames.ts';
import {
  clampCrop, cropRect, defaultVideoLayer, editAt, frameRecipe, panCrop, panFull, regions, removeKey, setKey, setLayoutAt, valueAt, zoomCrop,
} from './framing.ts';
import type { Animated, Layout, VideoLayer } from './project.ts';

const RATE: FrameRate = [30, 1];
const HD = { width: 1920, height: 1080 };
const FOLLOW = 1080 / 1920;

const close = (a: object, b: Record<string, number>) => {
  for (const [k, v] of Object.entries(b)) expect((a as Record<string, number>)[k], k).toBeCloseTo(v, 6);
};

describe('keyframes', () => {
  const keys: Animated<{ x: number }> = [
    { t: 1, value: { x: 0 }, ease: 'smooth' },
    { t: 3, value: { x: 1 }, ease: 'cut' },
    { t: 5, value: { x: 0.5 }, ease: 'cut' },
  ];

  it('holds the first value before the first keyframe and the last after the last', () => {
    expect(valueAt(keys, 0)).toEqual({ x: 0 });
    expect(valueAt(keys, 9)).toEqual({ x: 0.5 });
  });

  it('eases between smooth keyframes and holds after a cut', () => {
    expect(valueAt(keys, 2).x).toBeCloseTo(0.5);
    expect(valueAt(keys, 1.5).x).toBeLessThan(0.25); // eases in
    expect(valueAt(keys, 4.99)).toEqual({ x: 1 });
    expect(valueAt(keys, 5)).toEqual({ x: 0.5 });
  });

  it('never blends a layout', () => {
    const layouts: Animated<string> = [
      { t: 0, value: 'follow', ease: 'smooth' },
      { t: 2, value: 'split', ease: 'cut' },
    ];
    expect(valueAt(layouts, 1.99)).toBe('follow');
    expect(valueAt(layouts, 2)).toBe('split');
  });

  it('adds a keyframe on a frame, inheriting the easing before it', () => {
    const next = setKey(keys, 2.01, { x: 0.2 }, RATE);
    expect(next.map((k) => k.t)).toEqual([1, 2, 3, 5]);
    expect(next[1]).toEqual({ t: 2, value: { x: 0.2 }, ease: 'smooth' });
    expect(setKey(keys, 0.5, { x: 9 }, RATE)[0]!.ease).toBe('cut');
  });

  it('replaces a keyframe on the same frame', () => {
    const next = setKey(keys, 3.01, { x: 0.7 }, RATE);
    expect(next).toHaveLength(3);
    expect(next[1]).toEqual({ t: 3, value: { x: 0.7 }, ease: 'cut' });
  });

  it('edits a value with one keyframe everywhere, one with more at the playhead', () => {
    const single: Animated<{ x: number }> = [{ t: 1, value: { x: 0 }, ease: 'cut' }];
    expect(editAt(single, 4, { x: 1 }, RATE)).toEqual([{ t: 1, value: { x: 1 }, ease: 'cut' }]);
    expect(editAt(keys, 4, { x: 1 }, RATE)).toHaveLength(4);
  });

  it('switches layout from a point on, without repeating itself', () => {
    const one: Animated<Layout> = [{ t: 0, value: 'follow', ease: 'cut' }];
    const split = setLayoutAt(one, 2, 'split', RATE);
    expect(split.map((k) => [k.t, k.value])).toEqual([[0, 'follow'], [2, 'split']]);
    expect(setLayoutAt(split, 4, 'split', RATE)).toEqual(split);
    expect(setLayoutAt(split, 2, 'follow', RATE)).toEqual(one);
    expect(setLayoutAt(one, 0, 'full', RATE)).toEqual([{ t: 0, value: 'full', ease: 'cut' }]);
  });

  it('keeps the last keyframe', () => {
    expect(removeKey(keys, 1).map((k) => k.t)).toEqual([1, 5]);
    expect(removeKey([keys[0]!], 0)).toHaveLength(1);
  });
});

describe('crops', () => {
  it('is as tall as a wide source at zoom 1', () => {
    const r = cropRect({ x: 0.5, y: 0.5, zoom: 1 }, FOLLOW, HD);
    // 9:16 out of 16:9: 607.5 of 1920 pixels across, the full height.
    close(r, { w: 607.5 / 1920, h: 1, y: 0, x: 0.5 - 607.5 / 3840 });
  });

  it('is as wide as a tall source at zoom 1', () => {
    const r = cropRect({ x: 0.5, y: 0.5, zoom: 1 }, FOLLOW, { width: 1080, height: 2400 });
    close(r, { w: 1, h: (1080 / FOLLOW / 2400) });
  });

  it('stays inside the frame', () => {
    const r = cropRect({ x: 0, y: 1, zoom: 2 }, FOLLOW, HD);
    close(r, { x: 0, y: 0.5, h: 0.5 });
    close(clampCrop({ x: 0, y: 1, zoom: 2 }, FOLLOW, HD), { x: r.w / 2, y: 0.75, zoom: 2 });
  });

  it('pans with the drag: dragging right shows more of the left', () => {
    const region = regions('follow')[0]!;
    const start = { x: 0.5, y: 0.5, zoom: 1 };
    const moved = panCrop(start, region, HD, 540, 0);
    const w = cropRect(start, FOLLOW, HD).w;
    expect(moved.x).toBeCloseTo(0.5 - w / 2);
    expect(moved.y).toBeCloseTo(0.5);
  });

  it('zooms around the pointer', () => {
    const region = regions('follow')[0]!;
    const start = { x: 0.5, y: 0.5, zoom: 1 };
    const before = cropRect(start, FOLLOW, HD);
    const zoomed = zoomCrop(start, region, HD, 2, 270, 480);
    const after = cropRect(zoomed, FOLLOW, HD);
    // The source point a quarter of the way in stays a quarter of the way in.
    expect(after.x + 0.25 * after.w).toBeCloseTo(before.x + 0.25 * before.w);
    expect(after.y + 0.25 * after.h).toBeCloseTo(before.y + 0.25 * before.h);
    expect(zoomed.zoom).toBe(2);
  });
});

describe('frame recipes', () => {
  const layer = (patch: Partial<VideoLayer>): VideoLayer => ({ ...defaultVideoLayer(0, '00000000-0000-4000-8000-000000000000'), ...patch });

  it('fills the output with one crop in Follow', () => {
    const r = frameRecipe(layer({}), 0, HD);
    expect(r).toMatchObject({ layout: 'follow', background: null });
    expect(r.draws).toHaveLength(1);
    expect(r.draws[0]!.dst).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
  });

  it('stacks two 9:8 crops in Split', () => {
    const r = frameRecipe(layer({ layout: [{ t: 0, value: 'split', ease: 'cut' }] }), 0, HD);
    expect(r.draws.map((d) => d.dst)).toEqual([
      { x: 0, y: 0, w: 1080, h: 960 },
      { x: 0, y: 960, w: 1080, h: 960 },
    ]);
    const [top, bottom] = r.draws.map((d) => d.src);
    // 9:8 out of 16:9 at full height: 1215 of 1920 pixels across.
    expect(top!.w).toBeCloseTo(1215 / 1920);
    expect(top!.x).toBe(0); // centred at 0.25, pushed back inside
    expect(bottom!.x + bottom!.w).toBeCloseTo(1);
  });

  it('puts the whole frame over a blurred background in Full', () => {
    const r = frameRecipe(layer({ layout: [{ t: 0, value: 'full', ease: 'cut' }] }), 0, HD);
    expect(r.background).toBe('blur');
    expect(r.draws[0]!.dst).toEqual({ x: 0, y: (1920 - 607.5) / 2, w: 1080, h: 607.5 });
    expect(r.draws[0]!.src).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('cuts off what a zoomed full frame pushes past the edges', () => {
    const r = frameRecipe(
      layer({ layout: [{ t: 0, value: 'full', ease: 'cut' }], full: [{ t: 0, value: { y: -1, zoom: 2 }, ease: 'cut' }] }),
      0,
      HD,
    );
    const d = r.draws[0]!;
    expect(d.dst).toEqual({ x: 0, y: 0, w: 1080, h: 1215 });
    close(d.src, { x: 0.25, y: 0, w: 0.5, h: 1 });
  });

  it('slides the full frame up and down, within the output', () => {
    const room = (1920 - 607.5) / 2;
    expect(panFull({ y: 0, zoom: 1 }, HD, room / 2).y).toBeCloseTo(0.5);
    expect(panFull({ y: 0.9, zoom: 1 }, HD, room).y).toBe(1);
    // A 9:16 source fills the output exactly: nothing to slide.
    expect(panFull({ y: 0, zoom: 1 }, { width: 1080, height: 1920 }, 100).y).toBe(0);
  });

  it('switches layout at a keyframe', () => {
    const l = layer({ layout: [{ t: 0, value: 'follow', ease: 'cut' }, { t: 2, value: 'split', ease: 'cut' }] });
    expect(frameRecipe(l, 1.9, HD).layout).toBe('follow');
    expect(frameRecipe(l, 2, HD).layout).toBe('split');
  });
});
