import { describe, expect, it } from 'vitest';
import { ANALYSIS_VERSION, type ClipAnalysis, type Seat } from './analysis.ts';
import { clickedStretch, isPicked, stretchAt, stretchesOf, type Target } from './speakers.ts';
import type { VoiceTurn } from './voices.ts';

const WIDTH = 1000;
const HEIGHT = 500;

function seat(id: number, shot: number, x: number): Seat {
  const box = { x: x - 25, y: 100, w: 50, h: 50 };
  return { id, shot, box, samples: [{ t: 0, box, mouth: null }] };
}

const LEFT = { x: 0.2, y: 0.25, size: 0.05 };
const RIGHT = { x: 0.8, y: 0.25, size: 0.05 };

/** A close-up (0–10), a two-shot (10–20), another close-up (20–30), the same two-shot (30–40), and an empty shot (40–50). */
const analysis: ClipAnalysis = {
  version: ANALYSIS_VERSION,
  start: 0,
  end: 50,
  width: WIDTH,
  height: HEIGHT,
  shots: [
    { start: 0, end: 10 },
    { start: 10, end: 20 },
    { start: 20, end: 30 },
    { start: 30, end: 40 },
    { start: 40, end: 50 },
  ],
  seats: [seat(0, 0, 500), seat(1, 1, 200), seat(2, 1, 800), seat(3, 2, 500), seat(4, 3, 200), seat(5, 3, 800)],
};

const turns: VoiceTurn[] = [
  { start: 1, end: 9, voice: 0 },
  { start: 11, end: 14, voice: 0 },
  { start: 15, end: 19, voice: 1 },
  { start: 31, end: 34, voice: 1 },
  { start: 35, end: 39, voice: 0 },
];

const targetAt = (t: number, picks: Parameters<typeof stretchesOf>[2] = [], withTurns = turns): Target => stretchAt(stretchesOf(analysis, withTurns, picks), t)!.target;

describe('who to look at', () => {
  it('looks at the only person in a shot, whoever is talking', () => {
    expect(targetAt(5)).toEqual({ kind: 'seat', seat: 0, why: 'alone' });
    expect(targetAt(25)).toEqual({ kind: 'seat', seat: 3, why: 'alone' });
  });

  it('has no target in a shot with nobody in it', () => {
    expect(targetAt(45)).toEqual({ kind: 'none' });
  });

  it("can't tell with several people until a voice is placed", () => {
    expect(targetAt(12)).toEqual({ kind: 'group' });
    expect(targetAt(32)).toEqual({ kind: 'group' });
  });

  it('follows a pick for its turn, and learns where the voice sits for later shots', () => {
    const picks = [{ t: 12, ...LEFT }];
    expect(targetAt(12, picks)).toEqual({ kind: 'seat', seat: 1, why: 'pick' });
    expect(targetAt(36, picks)).toEqual({ kind: 'seat', seat: 4, why: 'place' });
  });

  it('gives the only seat left to the other voice', () => {
    const picks = [{ t: 12, ...LEFT }];
    expect(targetAt(16, picks)).toEqual({ kind: 'seat', seat: 2, why: 'left' });
    expect(targetAt(32, picks)).toEqual({ kind: 'seat', seat: 5, why: 'left' });
  });

  it('lets a pick overrule what was learned, in its own turn only', () => {
    const picks = [{ t: 12, ...LEFT }, { t: 32, ...LEFT }];
    expect(targetAt(32, picks)).toEqual({ kind: 'seat', seat: 4, why: 'pick' });
    // Voice 1 was placed on the left by that pick, and voice 0 by the first one; both sit there now.
    expect(targetAt(16, picks)).toEqual({ kind: 'seat', seat: 1, why: 'place' });
  });

  it('goes with most of the picks of a voice, the latest on a tie', () => {
    const many: VoiceTurn[] = [
      { start: 11, end: 12, voice: 0 },
      { start: 13, end: 14, voice: 0 },
      { start: 15, end: 16, voice: 0 },
      { start: 35, end: 39, voice: 0 },
    ];
    const tie = [{ t: 11.5, ...LEFT }, { t: 13.5, ...RIGHT }];
    expect(targetAt(36, tie, many)).toEqual({ kind: 'seat', seat: 5, why: 'place' });
    expect(targetAt(36, [...tie, { t: 15.5, ...LEFT }], many)).toEqual({ kind: 'seat', seat: 4, why: 'place' });
  });

  it('keeps looking at the same person through a pause, and takes the next one at the start of a shot', () => {
    const picks = [{ t: 12, ...LEFT }, { t: 16, ...RIGHT }];
    expect(targetAt(14.5, picks)).toEqual({ kind: 'seat', seat: 1, why: 'held' });
    expect(targetAt(10.5, picks)).toEqual({ kind: 'seat', seat: 1, why: 'held' });
    expect(targetAt(19.5, picks)).toEqual({ kind: 'seat', seat: 2, why: 'held' });
  });

  it('takes a pick in a pause for that pause only, and learns no voice from it', () => {
    const picks = [{ t: 14.5, ...RIGHT }];
    expect(targetAt(14.5, picks)).toEqual({ kind: 'seat', seat: 2, why: 'pick' });
    expect(targetAt(12, picks)).toEqual({ kind: 'group' });
    expect(targetAt(16, picks)).toEqual({ kind: 'group' });
  });

  it("doesn't carry a place to a shot from another camera angle", () => {
    const tight: ClipAnalysis = {
      ...analysis,
      seats: analysis.seats.map((s) => (s.shot === 3 ? { ...s, box: { x: s.box.x - 75, y: 25, w: 200, h: 200 } } : s)),
    };
    const stretches = stretchesOf(tight, turns, [{ t: 12, ...LEFT }]);
    expect(stretchAt(stretches, 36)!.target).toEqual({ kind: 'group' });
  });

  it('says which pick decided a stretch, the latest one when there are several', () => {
    const first = { t: 12, ...LEFT };
    const second = { t: 13, ...RIGHT };
    expect(stretchAt(stretchesOf(analysis, [], [first, second]), 12)!.pick).toBe(second);
    expect(stretchAt(stretchesOf(analysis, turns, [first]), 12)!.pick).toBe(first);
    expect(stretchAt(stretchesOf(analysis, turns, [first]), 36)!.pick).toBeNull();
    expect(stretchAt(stretchesOf(analysis, turns, [first]), 14.5)!.pick).toBeNull();
  });

  it("ignores a point that's on nobody in this shot", () => {
    expect(targetAt(12, [{ t: 12, x: 0.5, y: 0.9, size: 0.05 }])).toEqual({ kind: 'group' });
  });

  it('with no voices at all, a pick holds for its shot', () => {
    expect(targetAt(18, [{ t: 12, ...RIGHT }], [])).toEqual({ kind: 'seat', seat: 2, why: 'pick' });
    expect(targetAt(32, [{ t: 12, ...RIGHT }], [])).toEqual({ kind: 'group' });
  });

  it('covers the whole clip without gaps, with a turn cut at a camera cut', () => {
    const across: VoiceTurn[] = [{ start: 8, end: 12, voice: 0 }];
    const stretches = stretchesOf(analysis, across, []);
    expect(stretches[0]!.start).toBe(0);
    expect(stretches.at(-1)!.end).toBe(50);
    stretches.slice(1).forEach((s, i) => expect(s.start).toBe(stretches[i]!.end));
    expect(stretches.find((s) => s.voice === 0)).toMatchObject({ start: 10, end: 12 });
  });

  it('takes a click in the pause that opens a shot for the turn to come', () => {
    const stretches = stretchesOf(analysis, turns, []);
    expect(clickedStretch(stretches, 10.5)).toMatchObject({ start: 11, voice: 0 });
    // A pause between turns stays a pause, and turns and one-person shots are themselves.
    expect(clickedStretch(stretches, 14.5)).toMatchObject({ start: 14, voice: null });
    expect(clickedStretch(stretches, 12)).toMatchObject({ start: 11 });
    expect(clickedStretch(stretches, 5)).toMatchObject({ start: 0, end: 10 });
    expect(clickedStretch(stretchesOf(analysis, [], []), 12)).toMatchObject({ start: 10, end: 20 });
    expect(clickedStretch([], 1)).toBeNull();
  });

  it('tells a seat that was picked from one that was worked out', () => {
    const stretches = stretchesOf(analysis, turns, [{ t: 12, ...LEFT }]);
    expect(isPicked(stretchAt(stretches, 12)!, 1)).toBe(true);
    expect(isPicked(stretchAt(stretches, 12)!, 2)).toBe(false);
    expect(isPicked(stretchAt(stretches, 36)!, 4)).toBe(false);
  });

  it('finds the stretch at a moment, and the last one past the end', () => {
    const stretches = stretchesOf(analysis, turns, []);
    expect(stretchAt(stretches, 45)).toBe(stretches.at(-1));
    expect(stretchAt(stretches, 60)).toBe(stretches.at(-1));
    expect(stretchAt([], 1)).toBeNull();
  });
});
