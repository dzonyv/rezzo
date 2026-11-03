/**
 * What the clip analysis finds in a clip's working file: camera cuts and
 * the people in each shot. Derived data, kept in the cache next to the
 * working file (`<working file>.analysis.v1.json`), never in the project.
 *
 * Times are source seconds, like everything else. Boxes are source pixels.
 */
import { z } from 'zod';
import { centreOf, sizeOf, type Box } from './heads.ts';

/** Bumped when the result would come out differently, so old caches are redone. */
export const ANALYSIS_VERSION = 1;

/** Frames per second the people analysis runs at (pose is ~15 ms a frame). */
export const ANALYSIS_FPS = 10;

/** Side of the grey thumbnails cut detection compares. */
export const THUMB_W = 32;
export const THUMB_H = 18;
/** Mean difference (0–255) between thumbnails 0.1 s apart that counts as a cut. Motion stays under ~10. */
export const CUT_DIFF = 20;
/** Shots shorter than this are folded into the next one. */
export const MIN_SHOT = 0.5;

/** A detection within this many head sizes of a seat's mean position sits in it. */
const SEAT_REACH = 1.6;
/** Share of a shot's analysed frames a seat must be found in to count. */
const SEAT_MIN_SHARE = 0.15;
/** Seconds either side that smoothing averages over. */
const SMOOTH = 0.5;

const seconds = z.number().finite().nonnegative();
const boxSchema = z.object({ x: z.number().finite(), y: z.number().finite(), w: z.number().positive(), h: z.number().positive() });

export const headSampleSchema = z.object({
  t: seconds,
  box: boxSchema,
  /** Mouth opening (see heads.ts), when the face was big enough to measure. */
  mouth: z.number().nonnegative().nullable(),
});
export type HeadSample = z.infer<typeof headSampleSchema>;

export const shotSchema = z.object({ start: seconds, end: seconds });
export type Shot = z.infer<typeof shotSchema>;

export const seatSchema = z.object({
  /** Unique within the analysis. */
  id: z.number().int().nonnegative(),
  shot: z.number().int().nonnegative(),
  /** Mean head position over the shot. */
  box: boxSchema,
  samples: z.array(headSampleSchema),
});
export type Seat = z.infer<typeof seatSchema>;

export const clipAnalysisSchema = z.object({
  version: z.literal(ANALYSIS_VERSION),
  /** The span analysed (the working file's). */
  start: seconds,
  end: seconds,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  shots: z.array(shotSchema),
  seats: z.array(seatSchema),
});
export type ClipAnalysis = z.infer<typeof clipAnalysisSchema>;

/** Mean absolute difference of two grey thumbnails, 0–255. */
export function thumbDiff(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / a.length;
}

/**
 * Camera cuts from one grey thumbnail per frame. A frame is a candidate when
 * it differs by CUT_DIFF from the one 0.1 s earlier; a run of candidates
 * (a hard cut is one, a dissolve several) becomes one cut, on the frame that
 * changed most. Returns the shots between `start` and `end`.
 */
export function shotsOf(thumbs: readonly Uint8Array[], fps: number, start: number, end: number): Shot[] {
  const step = Math.max(1, Math.round(fps / 10));
  const candidate = thumbs.map((t, i) => i >= step && thumbDiff(t, thumbs[i - step]!) >= CUT_DIFF);
  const cuts: number[] = [];
  for (let i = 0; i < thumbs.length; ) {
    if (!candidate[i]) {
      i++;
      continue;
    }
    // Candidates up to `step` frames apart belong to one change.
    let j = i;
    while (j + 1 < thumbs.length && candidate.slice(j + 1, j + 1 + step).some(Boolean)) j++;
    // The change begins up to `step` frames before the first candidate.
    let best = i;
    let most = -1;
    for (let k = Math.max(1, i - step + 1); k <= j; k++) {
      const d = thumbDiff(thumbs[k]!, thumbs[k - 1]!);
      if (d > most) {
        most = d;
        best = k;
      }
    }
    cuts.push(start + best / fps);
    i = j + 1;
  }
  const shots: Shot[] = [];
  let from = start;
  for (const c of cuts) {
    if (c - from < MIN_SHOT) continue;
    if (end - c < MIN_SHOT) break;
    shots.push({ start: from, end: c });
    from = c;
  }
  shots.push({ start: from, end });
  return shots;
}

/** The shot that contains `t` (the last one for `t` at or past the end). */
export function shotIndexAt(shots: readonly Shot[], t: number): number {
  let lo = 0;
  let hi = shots.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (shots[mid]!.start <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface AnalysedFrame {
  t: number;
  heads: { box: Box; mouth: number | null }[];
}

/**
 * People sit still in a podcast, so within a shot every head detection joins
 * the nearest seat whose mean position is within SEAT_REACH head sizes, or
 * opens a new one. Seats found in less than SEAT_MIN_SHARE of the shot's
 * frames are dropped (hands, posters, someone walking past). This keeps one
 * id per person even when pose loses them for seconds, which tracking from
 * frame to frame couldn't (spikes/REPORT.md, Phase 4 checks).
 */
export function seatsOf(frames: readonly AnalysedFrame[], shots: readonly Shot[]): Seat[] {
  const seats: Seat[] = [];
  shots.forEach((shot, s) => {
    const inShot = frames.filter((f) => f.t >= shot.start && f.t < shot.end);
    const open: { sx: number; sy: number; ss: number; samples: HeadSample[]; frames: Set<number> }[] = [];
    inShot.forEach((f, fi) => {
      for (const h of f.heads) {
        const c = centreOf(h.box);
        const size = sizeOf(h.box);
        let best: (typeof open)[number] | undefined;
        let bestD = SEAT_REACH;
        for (const seat of open) {
          const n = seat.samples.length;
          const d = Math.hypot(seat.sx / n - c.x, seat.sy / n - c.y) / ((seat.ss / n + size) / 2);
          if (d < bestD) {
            bestD = d;
            best = seat;
          }
        }
        if (!best) open.push((best = { sx: 0, sy: 0, ss: 0, samples: [], frames: new Set() }));
        best.sx += c.x;
        best.sy += c.y;
        best.ss += size;
        best.samples.push({ t: f.t, box: h.box, mouth: h.mouth });
        best.frames.add(fi);
      }
    });
    const kept = open.filter((seat) => seat.frames.size >= SEAT_MIN_SHARE * inShot.length);
    // Left to right, so seat order means something in a two-shot.
    kept.sort((a, b) => a.sx / a.samples.length - b.sx / b.samples.length);
    for (const seat of kept) {
      const n = seat.samples.length;
      const size = seat.ss / n;
      seats.push({
        id: seats.length,
        shot: s,
        box: { x: seat.sx / n - size / 2, y: seat.sy / n - size / 2, w: size, h: size },
        // Two heads of one frame in one seat: keep the closer to the mean.
        samples: onePerFrame(seat.samples, seat.sx / n, seat.sy / n),
      });
    }
  });
  return seats;
}

function onePerFrame(samples: HeadSample[], x: number, y: number): HeadSample[] {
  const byT = new Map<number, HeadSample>();
  const far = (s: HeadSample) => Math.hypot(centreOf(s.box).x - x, centreOf(s.box).y - y);
  for (const s of samples) {
    const other = byT.get(s.t);
    if (!other || far(s) < far(other)) byT.set(s.t, s);
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

/**
 * Where the seat's head is at `t`, smoothed over ±SMOOTH seconds (centred,
 * so no lag). Between detections it holds the nearest one; with none at all
 * in the shot, the seat's mean position.
 */
export function seatBoxAt(seat: Seat, t: number): Box {
  const near = seat.samples.filter((s) => Math.abs(s.t - t) <= SMOOTH);
  if (near.length === 0) {
    let best: HeadSample | undefined;
    for (const s of seat.samples) if (!best || Math.abs(s.t - t) < Math.abs(best.t - t)) best = s;
    return best?.box ?? seat.box;
  }
  let cx = 0;
  let cy = 0;
  let size = 0;
  for (const s of near) {
    cx += centreOf(s.box).x;
    cy += centreOf(s.box).y;
    size += sizeOf(s.box);
  }
  cx /= near.length;
  cy /= near.length;
  size /= near.length;
  return { x: cx - size / 2, y: cy - size / 2, w: size, h: size };
}
