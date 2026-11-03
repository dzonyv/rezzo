/**
 * Head tracking that survives short dropouts, re-run offline on the head
 * boxes the face lab saved (pose heads, 10 fps).
 *
 *   node faces/track.ts
 *
 * Phase 0's IoU tracker gave 101 track ids in clip C's 67 s wide shot with
 * two people in it: the pose model loses a person for a frame or two, and a
 * small head that moved has no overlap left with its old box. This one
 * matches by centre distance relative to head size, keeps a track for up to
 * MAX_GAP without detections, joins tracks that end and start close together
 * within a shot, drops very short ones, and smooths the result with a
 * centred window (no lag: the analysis is offline).
 *
 * Prints, per clip: shots, track ids before and after, how much of the clip
 * the tracks cover, and jitter (median frame-to-frame centre movement as a
 * share of head size) before and after smoothing.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mediaDir } from '../shared/paths.ts';
import { listClips } from '../whisper/clips.ts';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Frame {
  t: number;
  cut: boolean;
  heads: { id: number; box: Box }[];
}
interface Lab {
  width: number;
  height: number;
  fps: number;
  frames: Frame[];
}

export interface Sample {
  frame: number;
  box: Box;
}
export interface Track {
  id: number;
  shot: number;
  samples: Sample[];
}

const MAX_GAP = 2.0; // seconds a track waits for its person to come back
const MATCH = 0.9; // centre distance, in head sizes, that still counts as the same head
const JOIN = 1.5; // same, when joining two tracks across a gap
const MIN_TRACK = 0.5; // seconds; shorter tracks are noise
const SMOOTH = 0.5; // seconds either side for smoothing

const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const size = (b: Box) => Math.max(b.w, b.h);
function distance(a: Box, b: Box): number {
  const ca = centre(a);
  const cb = centre(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y) / ((size(a) + size(b)) / 2);
}
const sameSize = (a: Box, b: Box) => size(a) / size(b) < 1.8 && size(b) / size(a) < 1.8;

export function track(frames: Frame[], fps: number): Track[] {
  const done: Track[] = [];
  let open: Track[] = [];
  let shot = 0;
  let next = 0;
  frames.forEach((f, i) => {
    if (f.cut && i > 0) {
      done.push(...open);
      open = [];
      shot++;
    }
    open = open.filter((t) => {
      if (i - t.samples.at(-1)!.frame <= MAX_GAP * fps) return true;
      done.push(t);
      return false;
    });
    // Greedy: closest pairs first.
    const pairs = f.heads
      .flatMap((h, hi) =>
        open.map((t, ti) => ({
          hi,
          ti,
          d: distance(h.box, t.samples.at(-1)!.box),
        })),
      )
      .filter((p) => p.d < MATCH && sameSize(f.heads[p.hi].box, open[p.ti].samples.at(-1)!.box))
      .sort((a, b) => a.d - b.d);
    const usedH = new Set<number>();
    const usedT = new Set<number>();
    for (const p of pairs) {
      if (usedH.has(p.hi) || usedT.has(p.ti)) continue;
      usedH.add(p.hi);
      usedT.add(p.ti);
      open[p.ti].samples.push({ frame: i, box: f.heads[p.hi].box });
    }
    f.heads.forEach((h, hi) => {
      if (!usedH.has(hi)) open.push({ id: next++, shot, samples: [{ frame: i, box: h.box }] });
    });
  });
  done.push(...open);
  return joinAndDrop(done, fps);
}

/** Joins a track to one that starts after it ends, in the same shot, close by. */
function joinAndDrop(tracks: Track[], fps: number): Track[] {
  const sorted = [...tracks].sort((a, b) => a.samples[0].frame - b.samples[0].frame);
  const out: Track[] = [];
  for (const t of sorted) {
    const first = t.samples[0];
    const before = out
      .filter((o) => o.shot === t.shot && o.samples.at(-1)!.frame < first.frame)
      .map((o) => ({ o, d: distance(o.samples.at(-1)!.box, first.box) }))
      .filter((c) => c.d < JOIN && sameSize(c.o.samples.at(-1)!.box, first.box))
      .sort((a, b) => a.d - b.d)[0];
    // Only join when nothing else in this shot already claimed that spot meanwhile.
    if (before) before.o.samples.push(...t.samples);
    else out.push({ ...t, samples: [...t.samples] });
  }
  return out.filter((t) => (t.samples.at(-1)!.frame - t.samples[0].frame + 1) / fps >= MIN_TRACK).map((t, i) => ({ ...t, id: i }));
}

/** Centred moving average over ±SMOOTH seconds of the samples a track has. */
export function smooth(t: Track, fps: number): Track {
  const r = SMOOTH * fps;
  const samples = t.samples.map((s) => {
    const near = t.samples.filter((o) => Math.abs(o.frame - s.frame) <= r);
    const avg = (f: (b: Box) => number) => near.reduce((sum, o) => sum + f(o.box), 0) / near.length;
    const w = avg((b) => b.w);
    const h = avg((b) => b.h);
    return {
      frame: s.frame,
      box: {
        x: avg((b) => b.x + b.w / 2) - w / 2,
        y: avg((b) => b.y + b.h / 2) - h / 2,
        w,
        h,
      },
    };
  });
  return { ...t, samples };
}

function jitter(tracks: Track[]): number {
  const steps: number[] = [];
  for (const t of tracks) {
    for (let k = 1; k < t.samples.length; k++) {
      const a = t.samples[k - 1];
      const b = t.samples[k];
      if (b.frame === a.frame + 1) steps.push(distance(a.box, b.box));
    }
  }
  steps.sort((a, b) => a - b);
  return steps[Math.floor(steps.length / 2)] ?? 0;
}

/** The old tracker's ids, as tracks, for comparison. */
function labTracks(frames: Frame[]): Track[] {
  const byId = new Map<number, Track>();
  let shot = 0;
  frames.forEach((f, i) => {
    if (f.cut && i > 0) shot++;
    for (const h of f.heads) {
      const t = byId.get(h.id) ?? { id: h.id, shot, samples: [] };
      t.samples.push({ frame: i, box: h.box });
      byId.set(h.id, t);
    }
  });
  return [...byId.values()];
}

export interface Seat {
  shot: number;
  x: number;
  y: number;
  size: number;
  frames: number;
}

const SEAT = 1.2; // head sizes from a seat's mean position
const MIN_SEAT = 0.15; // share of the shot's frames a seat must be found in

/**
 * People in a podcast stay in their seats. Within each shot, every head
 * detection joins the nearest seat whose running mean position is within
 * SEAT head sizes, or opens a new one; seats found in too few frames are
 * dropped (hands, posters, detections of a passer-by).
 */
export function seats(frames: Frame[]): Seat[] {
  const out: Seat[] = [];
  let shot = 0;
  let start = 0;
  let current: (Seat & { sx: number; sy: number; ss: number })[] = [];
  const close = (end: number) => {
    for (const s of current)
      if (s.frames >= MIN_SEAT * (end - start))
        out.push({
          shot: s.shot,
          x: s.x,
          y: s.y,
          size: s.size,
          frames: s.frames,
        });
    current = [];
  };
  frames.forEach((f, i) => {
    if (f.cut && i > 0) {
      close(i);
      shot++;
      start = i;
    }
    for (const h of f.heads) {
      const c = centre(h.box);
      const s = size(h.box);
      const near = current
        .map((seat) => ({
          seat,
          d: Math.hypot(seat.x - c.x, seat.y - c.y) / ((seat.size + s) / 2),
        }))
        .filter((n) => n.d < SEAT)
        .sort((a, b) => a.d - b.d)[0];
      const seat =
        near?.seat ??
        current[
          current.push({
            shot,
            x: 0,
            y: 0,
            size: 0,
            frames: 0,
            sx: 0,
            sy: 0,
            ss: 0,
          }) - 1
        ];
      seat.frames++;
      seat.sx += c.x;
      seat.sy += c.y;
      seat.ss += s;
      seat.x = seat.sx / seat.frames;
      seat.y = seat.sy / seat.frames;
      seat.size = seat.ss / seat.frames;
    }
  });
  close(frames.length);
  return out;
}

if (process.argv[1] !== import.meta.filename) {
  // Imported for seats() and track(); skip the report.
} else {
  await report();
}

async function report() {
  const results = [];
  for (const clip of listClips()) {
    const lab = JSON.parse(await readFile(path.join(mediaDir, 'faces', `${clip.id}.json`), 'utf8')) as Lab;
    const found = seats(lab.frames);
    const perShot = new Map<number, number>();
    for (const s of found) perShot.set(s.shot, (perShot.get(s.shot) ?? 0) + 1);
    const counts = [...perShot.values()];
    console.log(
      `${clip.id} seats per shot: ${counts.join(' ')}${clip.id === 'clip-c' ? `  (${found.map((s) => `x ${s.x.toFixed(0)}, ${s.frames} frames`).join('; ')})` : ''}`,
    );
  }
  console.log('\nclip    shots  ids before → after (≥ 5 s)  heads kept  jitter raw → smoothed');
  for (const clip of listClips()) {
    const lab = JSON.parse(await readFile(path.join(mediaDir, 'faces', `${clip.id}.json`), 'utf8')) as Lab;
    const before = labTracks(lab.frames);
    const tracks = track(lab.frames, lab.fps);
    const smoothed = tracks.map((t) => smooth(t, lab.fps));
    const detections = lab.frames.reduce((n, f) => n + f.heads.length, 0);
    const kept = tracks.reduce((n, t) => n + t.samples.length, 0);
    const long = tracks.filter((t) => t.samples.length >= 5 * lab.fps).length;
    const shots = lab.frames.filter((f, i) => f.cut && i > 0).length + 1;
    const r = {
      clip: clip.id,
      shots,
      idsBefore: before.length,
      idsAfter: tracks.length,
      longTracks: long,
      kept: kept / detections,
      jitterRaw: jitter(tracks),
      jitterSmoothed: jitter(smoothed),
    };
    results.push(r);
    console.log(
      `${clip.id}  ${String(shots).padStart(5)}  ${String(r.idsBefore).padStart(10)} → ${String(r.idsAfter).padStart(3)} (${long})`.padEnd(38) +
        `${(100 * r.kept).toFixed(0).padStart(6)}%   ${(100 * r.jitterRaw).toFixed(1).padStart(5)}% → ${(100 * r.jitterSmoothed).toFixed(1)}%`,
    );
  }
  await writeFile(path.join(mediaDir, 'faces', 'tracks.json'), JSON.stringify(results, null, 2));
}
