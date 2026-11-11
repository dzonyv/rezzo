import { describe, expect, it } from 'vitest';
import type { AudioAsset } from './assets.ts';
import { followAnchor, followerOf, suggestedSound, syncFollowers } from './follow-sounds.ts';
import { defaultVideoLayer } from './framing.ts';
import type { FrameRate } from './frames.ts';
import { DEFAULT_MOTION, type Motion } from './motion.ts';
import type { Clip, ImageLayer, SoundLayer } from './project.ts';

const RATE: FrameRate = [25, 1];
const IMAGE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const music: AudioAsset = { id: '3e0b8c1a-55f2-4b7e-8a51-0c6b1f7d2e44', kind: 'audio', path: 'D:/m.mp3', name: 'm.mp3', size: 1, fingerprint: 'c'.repeat(64), codec: 'mp3', duration: 2 };

const image = (start: number, end: number, motion: Motion = DEFAULT_MOTION): ImageLayer => ({
  id: IMAGE, kind: 'image', assetId: crypto.randomUUID(), start, end, transform: [{ t: start, value: { x: 0.5, y: 0.5, scale: 0.5, rotation: 0, opacity: 1 }, ease: 'cut' }], motion, key: null,
});

const follower = (part: 'in' | 'out', shift = 0, sound: SoundLayer['sound'] = { library: 'whoosh' }): SoundLayer => ({
  id: crypto.randomUUID(), kind: 'sound', sound, start: 0, end: 0.04, offset: 0, volume: 1, fadeIn: 0, fadeOut: 0, loop: true, evenLoudness: false, follows: { layerId: IMAGE, part, shift },
});

const clipOf = (...layers: Clip['layers']): Clip => ({ id: crypto.randomUUID(), name: 'x', start: 10, end: 20, skips: [], evenLoudness: false, layers: [defaultVideoLayer(10), ...layers] });

const slide: Motion = { ...DEFAULT_MOTION, out: { kind: 'slide', direction: 'right', seconds: 0.5 } };

describe('sounds that go with a layer', () => {
  it('starts with the entrance where the layer comes in, and with the exit where it starts going out', () => {
    expect(followAnchor(image(12, 15, slide), 'in')).toBe(12);
    expect(followAnchor(image(12, 15, slide), 'out')).toBe(14.5);
    // No exit: it goes when the layer ends.
    expect(followAnchor(image(12, 15), 'out')).toBe(15);
  });

  it('counts a shortened exit when the layer is too short for its whole entrance and exit', () => {
    // 0.35 s in and 0.5 s out wanted in 0.4 s: the exit gets 0.4 × 0.5 / 0.85.
    expect(followAnchor(image(12, 12.4, slide), 'out')).toBeCloseTo(12.4 - (0.4 * 0.5) / 0.85);
  });

  it('takes its time from the layer, on frames, as long as its sound, and never loops', () => {
    const sound = follower('out', 0.1);
    const clip = clipOf(image(12, 15, slide), sound);
    expect(syncFollowers(clip, [], RATE)).toBe(false);
    // Whoosh is 0.433 s: 11 frames at 25 fps, the last one only partly.
    expect(sound).toMatchObject({ start: 14.6, end: 15.04, loop: false });
    expect(sound.start * 25).toBeCloseTo(Math.round(sound.start * 25));
  });

  it('plays a file of the user\'s own from its offset to its end', () => {
    const sound = { ...follower('in', 0, { assetId: music.id }), offset: 0.5 };
    syncFollowers(clipOf(image(12, 15), sound), [music], RATE);
    expect(sound.start).toBe(12);
    // 1.5 s left in the file, up to the end of the frame it ends in.
    expect(sound.end).toBeCloseTo(13.52);
  });

  it("doesn't start before the clip", () => {
    const sound = follower('in', -0.5);
    syncFollowers(clipOf(image(10.2, 15), sound), [], RATE);
    expect(sound.start).toBe(10);
  });

  it('keeps the time of a sound whose file is missing', () => {
    const sound = follower('in', 0, { assetId: music.id });
    syncFollowers(clipOf(image(12, 15), sound), [], RATE);
    expect(sound).toMatchObject({ start: 0, end: 0.04 });
  });

  it('deletes a sound whose layer is gone, and a second one for the same part', () => {
    const first = follower('in');
    const clip = clipOf(image(12, 15), first, follower('in'), follower('out'));
    expect(syncFollowers(clip, [], RATE)).toBe(true);
    expect(clip.layers.filter((l) => l.kind === 'sound')).toHaveLength(2);
    expect(followerOf(clip, IMAGE, 'in')).toBe(first);
    clip.layers.splice(1, 1);
    expect(syncFollowers(clip, [], RATE)).toBe(true);
    expect(clip.layers).toHaveLength(1);
  });

  it('suggests a sound that suits the animation, and none for a fade', () => {
    const layer = image(12, 15, { ...slide, in: { kind: 'bounce', direction: 'left', seconds: 0.8 } });
    expect(suggestedSound(layer, 'in')).toBe('pop-cartoon');
    expect(suggestedSound(layer, 'out')).toBe('whoosh');
    expect(suggestedSound({ motion: { ...slide, in: { ...slide.in, kind: 'fade' } } }, 'in')).toBeNull();
  });
});
