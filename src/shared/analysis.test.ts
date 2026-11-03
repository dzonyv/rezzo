import { describe, expect, it } from 'vitest';
import { clipAnalysisSchema, seatBoxAt, seatsOf, shotIndexAt, shotsOf, THUMB_H, THUMB_W, type AnalysedFrame } from './analysis.ts';
import { cropAround, headFromPose, mouthOpening } from './heads.ts';

const flat = (v: number) => new Uint8Array(THUMB_W * THUMB_H).fill(v);
/** A thumbnail with some texture, shifted a little each frame like camera noise. */
const textured = (base: number, i: number) => Uint8Array.from({ length: THUMB_W * THUMB_H }, (_, k) => base + ((k + i) % 7));

describe('camera cuts', () => {
  it('finds a hard cut on the frame that changes', () => {
    const thumbs = [...Array.from({ length: 30 }, (_, i) => textured(40, i)), ...Array.from({ length: 30 }, (_, i) => textured(160, i))];
    expect(shotsOf(thumbs, 30, 10, 12)).toEqual([
      { start: 10, end: 11 },
      { start: 11, end: 12 },
    ]);
  });

  it('makes one cut of a dissolve', () => {
    // 0.5 s from dark to light at 30 fps.
    const thumbs = Array.from({ length: 90 }, (_, i) => flat(i < 30 ? 30 : i < 45 ? 30 + (i - 30) * 12 : 210));
    const shots = shotsOf(thumbs, 30, 0, 3);
    expect(shots).toHaveLength(2);
    expect(shots[0]!.end).toBeGreaterThanOrEqual(1);
    expect(shots[0]!.end).toBeLessThanOrEqual(1.5);
  });

  it('ignores motion, and shots too short to matter', () => {
    expect(shotsOf(Array.from({ length: 60 }, (_, i) => textured(100, i)), 30, 0, 2)).toEqual([{ start: 0, end: 2 }]);
    // A flash of 0.2 s right at the start.
    const thumbs = Array.from({ length: 60 }, (_, i) => flat(i >= 3 && i < 9 ? 250 : 20));
    expect(shotsOf(thumbs, 30, 0, 2)).toEqual([{ start: 0, end: 2 }]);
  });

  it('finds the shot at a moment', () => {
    const shots = [
      { start: 0, end: 1 },
      { start: 1, end: 3 },
      { start: 3, end: 4 },
    ];
    expect(shotIndexAt(shots, 0.5)).toBe(0);
    expect(shotIndexAt(shots, 1)).toBe(1);
    expect(shotIndexAt(shots, 3.9)).toBe(2);
    expect(shotIndexAt(shots, 9)).toBe(2);
  });
});

describe('seats', () => {
  const head = (x: number, size = 50) => ({ box: { x: x - size / 2, y: 100, w: size, h: size }, mouth: null });
  // 10 s at 10 fps: the right man is always found, the left one only every fourth frame, plus one stray detection.
  const frames: AnalysedFrame[] = Array.from({ length: 100 }, (_, i) => ({
    t: i / 10,
    heads: [head(800 + Math.sin(i) * 10), ...(i % 4 === 0 ? [head(200 + (i % 3) * 15, 40)] : []), ...(i === 50 ? [head(500, 30)] : [])],
  }));

  it('keeps one seat per person through dropouts, left to right', () => {
    const seats = seatsOf(frames, [{ start: 0, end: 10 }]);
    expect(seats).toHaveLength(2);
    expect(seats[0]!.box.x + seats[0]!.box.w / 2).toBeCloseTo(215, -1);
    expect(seats[1]!.samples).toHaveLength(100);
    expect(seats[0]!.samples).toHaveLength(25);
    expect(seats.map((s) => s.id)).toEqual([0, 1]);
  });

  it('starts over in every shot', () => {
    const seats = seatsOf(frames, [
      { start: 0, end: 5 },
      { start: 5, end: 10 },
    ]);
    expect(seats.map((s) => s.shot)).toEqual([0, 0, 1, 1]);
  });

  it('smooths a seat and holds it between detections', () => {
    const [left, right] = seatsOf(frames, [{ start: 0, end: 10 }]);
    const a = seatBoxAt(right!, 5);
    expect(a.x + a.w / 2).toBeCloseTo(800, -1);
    // Only every fourth frame has the left man; between, the nearest holds.
    expect(seatBoxAt(left!, 0.15).w).toBe(40);
  });

  it('checks a cached analysis', () => {
    const analysis = { version: 1, start: 0, end: 10, width: 1280, height: 720, shots: [{ start: 0, end: 10 }], seats: seatsOf(frames, [{ start: 0, end: 10 }]) };
    expect(clipAnalysisSchema.safeParse(analysis).success).toBe(true);
    expect(clipAnalysisSchema.safeParse({ ...analysis, version: 0 }).success).toBe(false);
  });
});

describe('heads', () => {
  it('sizes a head by the ears, or by the shoulders in profile', () => {
    const facing = Array.from({ length: 13 }, () => ({ x: 0.5, y: 0.3 }));
    facing[7] = { x: 0.45, y: 0.3 };
    facing[8] = { x: 0.55, y: 0.3 };
    const box = headFromPose(facing, 1000, 1000)!;
    expect(box.w).toBeCloseTo(140);
    expect(box.x + box.w / 2).toBeCloseTo(500, -1);

    const profile = Array.from({ length: 13 }, () => ({ x: 0.5, y: 0.3 }));
    profile[11] = { x: 0.4, y: 0.5 };
    profile[12] = { x: 0.6, y: 0.5 };
    expect(headFromPose(profile, 1000, 1000)!.w).toBeCloseTo(1.4 * 0.45 * 200);
    expect(headFromPose(profile.slice(0, 5), 1000, 1000)).toBeNull();
    expect(headFromPose(Array.from({ length: 13 }, () => ({ x: 0.5, y: 0.5 })), 1000, 1000)).toBeNull();
  });

  it('crops around a head inside the frame', () => {
    expect(cropAround({ x: 0, y: 0, w: 100, h: 100 }, 1280, 720, 2)).toEqual({ x: 0, y: 0, w: 200, h: 200 });
    expect(cropAround({ x: 1200, y: 600, w: 100, h: 100 }, 1280, 720, 2)).toEqual({ x: 1080, y: 520, w: 200, h: 200 });
  });

  it('measures the mouth against the face', () => {
    const face = Array.from({ length: 153 }, () => ({ x: 0, y: 0 }));
    face[10] = { x: 0, y: 0 };
    face[152] = { x: 0, y: 1 };
    face[13] = { x: 0, y: 0.6 };
    face[14] = { x: 0, y: 0.7 };
    expect(mouthOpening(face)).toBeCloseTo(0.1);
    expect(mouthOpening(face.slice(0, 20))).toBeNull();
  });
});
