import { describe, expect, it } from 'vitest';
import { ANALYSIS_VERSION, greyOf, type ClipAnalysis, type HeadSample } from './analysis.ts';
import { coverTitleOf } from './cover.ts';
import { coverCandidates, rankWithSharpness, sharpness, sharpnessRegion } from './cover-suggest.ts';

const clip = { start: 10, end: 20, skips: [{ start: 14, end: 15 }] };

/** A head `h` pixels tall at each time, its face found or not. */
const samples = (times: number[], h: number, face: boolean): HeadSample[] => times.map((t) => ({ t, box: { x: 500, y: 200, w: h, h }, mouth: face ? 0.1 : null }));

function analysis(seats: HeadSample[][], cuts: number[] = []): ClipAnalysis {
  const bounds = [10, ...cuts, 20];
  return {
    version: ANALYSIS_VERSION,
    start: 10,
    end: 20,
    width: 1280,
    height: 720,
    shots: bounds.slice(1).map((end, i) => ({ start: bounds[i]!, end })),
    seats: seats.map((s, id) => ({ id, shot: 0, box: s[0]!.box, samples: s })),
  };
}

describe('suggested cover frames', () => {
  it('prefers big faces turned to the camera, a second apart', () => {
    const small = samples([11, 11.5, 12], 100, true);
    const big = samples([16, 16.1, 16.2], 250, true);
    const away = samples([18], 250, false);
    const picked = coverCandidates(clip, analysis([small, big, away]), 3);
    expect(picked.map((c) => c.t)).toEqual([16, 18, 11]);
    expect(picked[0]!.score).toBeGreaterThan(picked[1]!.score);
  });

  it('leaves out frames the clip skips and frames right at a cut', () => {
    const seat = samples([12.9, 13.1, 14.5, 16.5], 250, true);
    expect(coverCandidates(clip, analysis([seat], [13]), 4).map((c) => c.t)).toEqual([16.5]);
  });

  it('spreads moments over the clip when nobody is found', () => {
    const picked = coverCandidates(clip, analysis([]), 3);
    // Nine seconds played; the skip's second is left out.
    expect(picked.map((c) => c.t)).toEqual([11.5, 15.5, 18.5]);
  });

  it('measures blur as a lower sharpness', () => {
    const w = 16;
    const stripes = Array.from({ length: w * w }, (_, i) => (i % 2 ? 255 : 0));
    const soft = Array.from({ length: w * w }, (_, i) => 100 + ((i % w) / w) * 50);
    expect(sharpness(stripes, w, w)).toBeGreaterThan(sharpness(soft, w, w));
    expect(sharpness(new Array(w * w).fill(128), w, w)).toBe(0);
  });

  it('measures sharpness around the biggest head, inside the frame', () => {
    const [best] = coverCandidates(clip, analysis([samples([16], 200, true)]), 1);
    expect(best!.head).toEqual({ x: 500, y: 200, w: 200, h: 200 });
    expect(sharpnessRegion(best!, 1280, 720)).toEqual({ x: 450, y: 150, w: 300, h: 300 });
    expect(sharpnessRegion({ t: 1, score: 1, head: { x: 1200, y: 650, w: 200, h: 200 } }, 1280, 720)).toEqual({ x: 1150, y: 600, w: 130, h: 120 });
    expect(sharpnessRegion({ t: 1, score: 1 }, 1280, 720)).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
    expect(Array.from(greyOf([30, 60, 90, 255, 255, 255, 255, 255]))).toEqual([60, 255]);
  });

  it('lets a sharp frame pass a slightly better blurred one', () => {
    const ranked = rankWithSharpness([{ t: 1, score: 0.9 }, { t: 2, score: 0.8 }], [10, 100], 2);
    expect(ranked.map((c) => c.t)).toEqual([2, 1]);
  });
});

describe('cover titles from the transcript', () => {
  it('puts the words on one line, without the full stop at the end', () => {
    expect(coverTitleOf([{ text: 'Ona' }, { text: 'je' }, { text: 'lagala.' }])).toBe('Ona je lagala');
    expect(coverTitleOf([{ text: 'Zašto?' }])).toBe('Zašto?');
  });
});
