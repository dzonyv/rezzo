import { describe, expect, it } from 'vitest';
import { coverClip, coverFraming, coverLeadFrames, coverOf, keptTime } from './cover.ts';
import { defaultVideoLayer } from './framing.ts';
import { DEFAULT_MOTION } from './motion.ts';
import type { Clip, TextLayer } from './project.ts';
import { DEFAULT_TEXT_STYLE } from './text-style.ts';

const video = defaultVideoLayer(10);
const clip: Clip = { id: crypto.randomUUID(), name: 'x', start: 10, end: 20, skips: [{ start: 12, end: 13 }], evenLoudness: false, layers: [video] };

const title: TextLayer = {
  id: crypto.randomUUID(), kind: 'text', text: 'Naslov', style: DEFAULT_TEXT_STYLE, start: 0, end: 1,
  transform: [{ t: 11, value: { x: 0.5, y: 0.4, scale: 1, rotation: 0, opacity: 1 }, ease: 'cut' }], motion: DEFAULT_MOTION,
};

describe('covers', () => {
  it('keeps the moment inside what the clip plays', () => {
    expect(keptTime(clip, 11)).toBe(11);
    expect(keptTime(clip, 12.5)).toBe(13);
    expect(keptTime(clip, 4)).toBe(10);
    expect(keptTime(clip, 25)).toBeCloseTo(20, 2);
    expect(keptTime(clip, 25)).toBeLessThan(20);
  });

  it('starts at the first frame with the clip framing and nothing over it', () => {
    expect(coverOf(clip)).toEqual({ time: 10, video: null, layers: [], inVideo: false });
    expect(coverOf({ ...clip, cover: { time: 12.2, video: null, layers: [], inVideo: false } }).time).toBe(13);
  });

  it("is drawn as the clip's video with the cover's layers up the whole clip, not moving", () => {
    const shown = coverClip({ ...clip, layers: [video, title], cover: { time: 11, video: null, layers: [title], inVideo: false } });
    expect(shown.layers.map((l) => l.kind)).toEqual(['video', 'text']);
    expect(shown.layers[0]).toBe(video);
    expect(shown.layers[1]).toMatchObject({ id: title.id, start: 10, end: 20, motion: { in: { kind: 'none' }, out: { kind: 'none' }, loop: { kind: 'none' } } });
    // The clip itself is left as it is, its range and cuts included.
    expect(shown).toMatchObject({ id: clip.id, start: 10, end: 20, skips: clip.skips });
  });

  it("uses framing of the cover's own when it has some", () => {
    const own = coverFraming({ ...video, layout: [{ t: 10, value: 'follow', ease: 'cut' }, { t: 15, value: 'split', ease: 'cut' }] }, 16);
    expect(own.layout).toEqual([{ t: 16, value: 'split', ease: 'cut' }]);
    expect(own.follow).toHaveLength(1);
    expect(coverClip({ ...clip, cover: { time: 16, video: own, layers: [], inVideo: false } }).layers[0]).toBe(own);
  });
});

describe('the cover in the video', () => {
  it('takes about a tenth of a second, at least one frame', () => {
    expect(coverLeadFrames(30)).toBe(3);
    expect(coverLeadFrames(60)).toBe(6);
    expect(coverLeadFrames(29.97)).toBe(3);
    expect(coverLeadFrames(4)).toBe(1);
  });
});
