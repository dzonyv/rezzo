import { describe, expect, it } from 'vitest';
import type { ImageAsset, VideoAsset } from './assets.ts';
import { newCaptionLayer } from './captions.ts';
import { DEFAULT_CAPTION_STYLE } from './caption-style.ts';
import { defaultVideoLayer } from './framing.ts';
import { DEFAULT_MOTION } from './motion.ts';
import type { Clip, ImageLayer, OverlayLayer } from './project.ts';
import { overlayTimeAt, quadContains, quadCorners, quadOf, sceneAt } from './scene.ts';

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
    key: null,
  };
}

const video: VideoAsset = {
  ...asset,
  id: '7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918',
  kind: 'video',
  codec: 'vp9',
  width: 1080,
  height: 1920,
  duration: 3,
  frameRate: [30, 1],
  colorSpace: null,
  alpha: true,
  hasAudio: false,
};

function overlay(start: number, end: number, offset: number, loop: boolean): OverlayLayer {
  return { ...image(start, end), kind: 'overlay', assetId: video.id, offset, volume: 1, loop };
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

  it('draws a video layer at its time in the file', () => {
    const c: Clip = { ...clip, layers: [defaultVideoLayer(0), overlay(2, 8, 0.5, false)] };
    const op = sceneAt(c, [video], 3, SOURCE)[1]!;
    expect(op).toMatchObject({ type: 'overlay', assetId: video.id, time: 1.5, key: null, quad: { w: 540, h: 960 } });
  });

  it('leaves out a layer whose file is of another kind', () => {
    const c: Clip = { ...clip, layers: [defaultVideoLayer(0), { ...overlay(2, 8, 0, false), assetId: asset.id }] };
    expect(sceneAt(c, [asset, video], 3, SOURCE).map((o) => o.type)).toEqual(['video']);
  });

  it('loops a video layer or holds its end', () => {
    expect(overlayTimeAt({ start: 2, offset: 0.5, loop: false }, 3, 3)).toBe(1.5);
    expect(overlayTimeAt({ start: 2, offset: 0.5, loop: false }, 3, 7)).toBe(3);
    expect(overlayTimeAt({ start: 2, offset: 0.5, loop: true }, 3, 5)).toBeCloseTo(0.5);
    expect(overlayTimeAt({ start: 2, offset: 0.5, loop: true }, 3, 7)).toBeCloseTo(2.5);
    // Asked about a moment before the layer starts, it shows its first frame.
    expect(overlayTimeAt({ start: 2, offset: 0.5, loop: false }, 3, 1)).toBe(0.5);
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
