import { describe, expect, it } from 'vitest';
import { cutDendrogram, dendrogram, piecesOf, turnsOf, voiceAt, voicesOf, type Span } from './voices.ts';

const v = (...xs: number[]) => Float32Array.from(xs);
const unit = (angle: number) => v(Math.cos(angle), Math.sin(angle));

describe('pieces', () => {
  it('joins words until a pause or the longest piece', () => {
    const words: Span[] = [
      { start: 0, end: 0.4 },
      { start: 0.45, end: 0.9 },
      { start: 1.3, end: 1.6 }, // after a 0.4 s pause
      { start: 1.65, end: 2.5 },
      { start: 2.55, end: 3.5 },
      { start: 3.55, end: 4.7 }, // would make the piece longer than 3 s
    ];
    expect(piecesOf(words)).toEqual([
      { start: 0, end: 0.9 },
      { start: 1.3, end: 3.5 },
      { start: 3.55, end: 4.7 },
    ]);
  });

  it('skips empty words and sorts', () => {
    expect(piecesOf([{ start: 2, end: 2.5 }, { start: 1, end: 1 }, { start: 0, end: 0.5 }])).toEqual([
      { start: 0, end: 0.5 },
      { start: 2, end: 2.5 },
    ]);
  });
});

describe('clustering', () => {
  it('merges closest first, with average linkage', () => {
    const merges = dendrogram([unit(0), unit(0.1), unit(1.5), unit(1.55)]);
    expect(merges).toHaveLength(3);
    expect(merges.map((m) => m.distance)).toEqual([...merges.map((m) => m.distance)].sort((a, b) => a - b));
    expect(cutDendrogram(4, merges, { k: 2 })).toEqual([0, 0, 1, 1]);
    expect(cutDendrogram(4, merges, { threshold: 0.01 })).toEqual([0, 0, 1, 1]);
    expect(cutDendrogram(4, merges, { threshold: 0 })).toEqual([0, 1, 2, 3]);
    expect(cutDendrogram(4, merges, { k: 1 })).toEqual([0, 0, 0, 0]);
  });

  it('gives the same groups as merging the closest pair over and over', () => {
    // Pseudo-random points on a circle; compare with the naive O(n³) version.
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const points = Array.from({ length: 40 }, () => unit(rand() * 6));
    const naive = (k: number) => {
      let groups = points.map((_, i) => [i]);
      const d = (a: number[], b: number[]) => {
        let s = 0;
        for (const i of a) for (const j of b) s += 1 - (points[i]![0]! * points[j]![0]! + points[i]![1]! * points[j]![1]!);
        return s / (a.length * b.length);
      };
      while (groups.length > k) {
        let best = { i: 0, j: 1, d: Infinity };
        for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) if (d(groups[i]!, groups[j]!) < best.d) best = { i, j, d: d(groups[i]!, groups[j]!) };
        groups[best.i] = groups[best.i]!.concat(groups[best.j]!);
        groups = groups.filter((_, x) => x !== best.j);
      }
      const label = new Array<number>(points.length);
      groups.forEach((g, n) => g.forEach((i) => (label[i] = n)));
      return label;
    };
    const merges = dendrogram(points);
    for (const k of [2, 3, 5]) {
      const ours = cutDendrogram(points.length, merges, { k });
      const theirs = naive(k);
      // Same partition: equal labels on one side exactly when equal on the other.
      for (let i = 0; i < points.length; i++) for (let j = 0; j < points.length; j++) expect(ours[i] === ours[j]).toBe(theirs[i] === theirs[j]);
    }
  });
});

describe('voices', () => {
  const pieces: Span[] = [
    { start: 0, end: 2 },
    { start: 2.5, end: 4 },
    { start: 4.5, end: 4.8 }, // short: joins the nearest voice
    { start: 5, end: 8 },
    { start: 9, end: 10.5 },
  ];
  const a = unit(0);
  const b = unit(1.4);

  it('finds the voices without being told how many, most talkative first', () => {
    expect(voicesOf(pieces, [b, b, a, a, a], 'auto')).toEqual([1, 1, 0, 0, 0]);
  });

  it('uses the given number of people', () => {
    expect(voicesOf(pieces, [b, b, a, a, a], 1)).toEqual([0, 0, 0, 0, 0]);
    expect(new Set(voicesOf(pieces, [unit(0), unit(0.3), unit(0.6), unit(0.9), unit(1.2)], 3)).size).toBe(3);
  });

  it('copes with no pieces and with only short ones', () => {
    expect(voicesOf([], [], 'auto')).toEqual([]);
    expect(voicesOf([{ start: 0, end: 0.5 }], [a], 'auto')).toEqual([0]);
  });

  it('joins neighbouring pieces into turns and finds the voice at a moment', () => {
    const turns = turnsOf(pieces, [1, 1, 0, 0, 1]);
    expect(turns).toEqual([
      { start: 0, end: 4, voice: 1 },
      { start: 4.5, end: 8, voice: 0 },
      { start: 9, end: 10.5, voice: 1 },
    ]);
    expect(voiceAt(turns, 1)).toBe(1);
    expect(voiceAt(turns, 4.2)).toBeNull();
    expect(voiceAt(turns, 7.99)).toBe(0);
    expect(voiceAt(turns, 8)).toBeNull();
    expect(voiceAt(turns, 11)).toBeNull();
  });
});
