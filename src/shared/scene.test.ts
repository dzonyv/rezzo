import { describe, expect, it } from 'vitest';
import type { ImageAsset } from './assets.ts';
import { newCaptionLayer } from './captions.ts';
import { DEFAULT_CAPTION_STYLE } from './caption-style.ts';
import { defaultVideoLayer } from './framing.ts';
import { DEFAULT_MOTION } from './motion.ts';
import type { Clip, ImageLayer } from './project.ts';
import { quadContains, quadCorners, quadOf, sceneAt } from './scene.ts';

const asset: ImageAsset = {
  id: '5d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a',
  kind: 'image',
  name: 'logo.png',
  path: 'C:\\logo.png',
  size: 100,
  fingerprint: 'b'.repeat(64),
  width: 400,
  height: 200,
};

function image(start: number, end: number): ImageLayer {
  return {
    id: crypto.randomUUID(),
    kind: 'image',
    assetId: asset.id,
    start,
    end,
    transform: [{ t: start, value: { x: 0.5, y: 0.25, scale: 0.5, rotation: 0, opacity: 1 }, ease: 'cut' }],
    motion: { ...DEFAULT_MOTION, in: { ...DEFAULT_MOTION.in, kind: 'none' } },
  };
}

const SOURCE = { width: 1920, height: 1080 };

describe('scene', () => {
  const clip: Clip = {
    id: crypto.randomUUID(),
    name: 'x',
    start: 0,
    end: 10,
    layers: [defaultVideoLayer(0), image(2, 4), newCaptionLayer(0, DEFAULT_CAPTION_STYLE)],
  };

  it('draws the layers in order, each only in its own time', () => {
    expect(sceneAt(clip, [asset], 1, SOURCE).map((o) => o.type)).toEqual(['video', 'captions']);
    expect(sceneAt(clip, [asset], 2, SOURCE).map((o) => o.type)).toEqual(['video', 'image', 'captions']);
    expect(sceneAt(clip, [asset], 3.99, SOURCE).map((o) => o.type)).toEqual(['video', 'image', 'captions']);
    expect(sceneAt(clip, [asset], 4, SOURCE).map((o) => o.type)).toEqual(['video', 'captions']);
  });

  it('leaves out a layer whose file it lacks', () => {
    expect(sceneAt(clip, [], 3, SOURCE).map((o) => o.type)).toEqual(['video', 'captions']);
  });

  it('sizes an image by the output width, keeping its shape', () => {
    const op = sceneAt(clip, [asset], 3, SOURCE)[1]!;
    expect(op).toMatchObject({ type: 'image', quad: { cx: 540, cy: 480, w: 540, h: 270, rotation: 0 }, opacity: 1 });
  });

  it('turns and hit-tests rotated quads', () => {
    const q = quadOf({ x: 0.5, y: 0.5, scale: 0.5, rotation: 90, opacity: 1 }, asset);
    const corners = quadCorners(q);
    // Turned a quarter clockwise: the top left corner is now top right.
    expect(corners[0]![0]).toBeCloseTo(540 + 135);
    expect(corners[0]![1]).toBeCloseTo(960 - 270);
    expect(quadContains(q, 540, 960 + 260)).toBe(true);
    expect(quadContains(q, 540 + 260, 960)).toBe(false);
  });
});
