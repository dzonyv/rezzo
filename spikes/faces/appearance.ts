/**
 * Can we tell it's the same person in a close-up and in the wide two-shot
 * by the colours of their clothes? Clip D only: it is the one clip with
 * several camera angles on the same two people.
 *
 *   node faces/appearance.ts
 *
 * Seats come from faces/track.ts. Each seat gets a colour histogram (hue
 * weighted by saturation, plus saturation and brightness) of the region
 * under the head, averaged over its shot. Seats are then clustered into two
 * people (average linkage, never joining two seats of the same shot), and
 * compared with who they really are: the shirt rule in close-ups (checked by
 * eye in Phase 0), and seating in the two-shot.
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { mediaDir } from '../shared/paths.ts';
import { ffmpegExe } from '../shared/tools.ts';
import { listClips } from '../whisper/clips.ts';
import { seats, type Seat } from './track.ts';

interface Lab {
  width: number;
  height: number;
  fps: number;
  frames: { cut: boolean; heads: { box: { x: number; y: number; w: number; h: number } }[] }[];
}

const THUMB_W = 320;

function thumbnails(file: string, fps: number, w: number, h: number): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegExe(), ['-v', 'error', '-i', file, '-map', '0:v:0', '-vf', `fps=${fps},scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const chunks: Buffer[] = [];
    ff.stdout.on('data', (c: Buffer) => chunks.push(c));
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited with ${code}`));
      const all = Buffer.concat(chunks);
      const size = w * h * 3;
      resolve(Array.from({ length: Math.floor(all.length / size) }, (_, i) => all.subarray(i * size, (i + 1) * size)));
    });
  });
}

const H_BINS = 12;
const S_BINS = 4;
const V_BINS = 4;

/** Hue (weighted by saturation), saturation and brightness histograms, each summing to 1. */
function histogram(img: Buffer, w: number, h: number, x0: number, y0: number, x1: number, y1: number, into: Float64Array) {
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x1)); x++) {
      const p = (y * w + x) * 3;
      const r = img[p] / 255;
      const g = img[p + 1] / 255;
      const b = img[p + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const s = max === 0 ? 0 : (max - min) / max;
      let hue = 0;
      if (max !== min) {
        if (max === r) hue = ((g - b) / (max - min) + 6) % 6;
        else if (max === g) hue = (b - r) / (max - min) + 2;
        else hue = (r - g) / (max - min) + 4;
      }
      into[Math.min(H_BINS - 1, Math.floor((hue / 6) * H_BINS))] += s;
      into[H_BINS + Math.min(S_BINS - 1, Math.floor(s * S_BINS))] += 1;
      into[H_BINS + S_BINS + Math.min(V_BINS - 1, Math.floor(max * V_BINS))] += 1;
    }
  }
}

function normalise(v: Float64Array): Float64Array {
  const parts: [number, number][] = [
    [0, H_BINS],
    [H_BINS, H_BINS + S_BINS],
    [H_BINS + S_BINS, H_BINS + S_BINS + V_BINS],
  ];
  const out = new Float64Array(v.length);
  for (const [a, b] of parts) {
    let sum = 0;
    for (let i = a; i < b; i++) sum += v[i];
    for (let i = a; i < b; i++) out[i] = sum > 0 ? v[i] / sum : 0;
  }
  return out;
}

/** 1 − Bhattacharyya coefficient, averaged over the three histograms. */
function distance(a: Float64Array, b: Float64Array): number {
  let bc = 0;
  for (let i = 0; i < a.length; i++) bc += Math.sqrt(a[i] * b[i]);
  return 1 - bc / 3;
}

const clip = listClips().find((c) => c.id === 'clip-d')!;
const lab = JSON.parse(await readFile(path.join(mediaDir, 'faces', `${clip.id}.json`), 'utf8')) as Lab;
const th = Math.round((THUMB_W * lab.height) / lab.width);
const s = THUMB_W / lab.width;
const frames = await thumbnails(clip.file, lab.fps, THUMB_W, th);

// Frame range of each shot.
const shots: { start: number; end: number }[] = [];
lab.frames.forEach((f, i) => {
  if (i === 0 || f.cut) shots.push({ start: i, end: i + 1 });
  else shots.at(-1)!.end = i + 1;
});

interface Described extends Seat {
  hist: Float64Array;
  truth: string | undefined;
  brightness: number;
}
const found = seats(lab.frames as never);
const described: Described[] = found.map((seat) => {
  const { start, end } = shots[seat.shot];
  const hist = new Float64Array(H_BINS + S_BINS + V_BINS);
  // The region under the head: the chest, half a head either side of the chin line.
  const x0 = (seat.x - 0.35 * seat.size) * s;
  const x1 = (seat.x + 0.35 * seat.size) * s;
  const y0 = (seat.y + 0.6 * seat.size) * s;
  const y1 = (seat.y + 1.1 * seat.size) * s;
  let bright = 0;
  let n = 0;
  for (let i = start; i < end && i < frames.length; i++) {
    histogram(frames[i], THUMB_W, th, x0, y0, x1, y1, hist);
    // The Phase 0 shirt rule's own region, for the ground truth.
    const img = frames[i];
    for (let y = Math.floor((seat.y + 0.5 * seat.size) * s); y < Math.min(th, (seat.y + 0.9 * seat.size) * s); y++) {
      for (let x = Math.floor((seat.x - 0.3 * seat.size) * s); x < Math.min(THUMB_W, (seat.x + 0.3 * seat.size) * s); x++) {
        if (x < 0 || y < 0) continue;
        const p = (y * THUMB_W + x) * 3;
        bright += (img[p] + img[p + 1] + img[p + 2]) / 3;
        n++;
      }
    }
  }
  return { ...seat, hist: normalise(hist), truth: undefined, brightness: n ? bright / n : 0 };
});

// Ground truth: seating in shots with two people, the shirt rule otherwise.
const rule = clip.identity as { dark: string; light: string; twoShotLeft: string };
for (const shot of new Set(described.map((d) => d.shot))) {
  const inShot = described.filter((d) => d.shot === shot).sort((a, b) => a.x - b.x);
  if (inShot.length === 1) inShot[0].truth = inShot[0].brightness > 100 ? rule.light : rule.dark;
  else if (inShot.length === 2) {
    inShot[0].truth = rule.twoShotLeft;
    inShot[1].truth = rule.twoShotLeft === rule.dark ? rule.light : rule.dark;
  }
}

// Average linkage into two people; seats of the same shot can't be one person.
let groups = described.map((_, i) => [i]);
const linkage = (a: number[], b: number[]) => {
  for (const i of a) for (const j of b) if (described[i].shot === described[j].shot) return Infinity;
  let sum = 0;
  for (const i of a) for (const j of b) sum += distance(described[i].hist, described[j].hist);
  return sum / (a.length * b.length);
};
while (groups.length > 2) {
  let best = { i: -1, j: -1, d: Infinity };
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
    const d = linkage(groups[i], groups[j]);
    if (d < best.d) best = { i, j, d };
  }
  if (best.i < 0) break;
  groups[best.i] = groups[best.i].concat(groups[best.j]);
  groups = groups.filter((_, k) => k !== best.j);
}

// Score with the better of the two possible namings.
const labelled = described.map((d, i) => ({ d, group: groups.findIndex((g) => g.includes(i)) })).filter((x) => x.d.truth);
const names = [rule.dark, rule.light];
const right = Math.max(
  ...[0, 1].map((flip) => labelled.filter((x) => names[(x.group + flip) % 2] === x.d.truth).length),
);
const twoShot = labelled.filter((x) => described.filter((o) => o.shot === x.d.shot).length > 1);
const flipBest = [0, 1].find((flip) => labelled.filter((x) => names[(x.group + flip) % 2] === x.d.truth).length === right)!;
console.log(`seats: ${described.length} in ${shots.length} shots, ${labelled.length} with a known person`);
console.log(`right person: ${right} of ${labelled.length}`);
console.log(`in the two-shot: ${twoShot.filter((x) => names[(x.group + flipBest) % 2] === x.d.truth).length} of ${twoShot.length}`);
for (const x of labelled) console.log(`  shot ${String(x.d.shot).padStart(2)}  x ${x.d.x.toFixed(0).padStart(4)}  size ${x.d.size.toFixed(0).padStart(3)}  truth ${x.d.truth}  group ${names[(x.group + flipBest) % 2]}`);

// How far apart are seats of the same person and of different people?
const same: number[] = [];
const diff: number[] = [];
for (let i = 0; i < labelled.length; i++) for (let j = i + 1; j < labelled.length; j++) {
  const d = distance(labelled[i].d.hist, labelled[j].d.hist);
  (labelled[i].d.truth === labelled[j].d.truth ? same : diff).push(d);
}
const mean = (v: number[]) => (v.reduce((a, b) => a + b, 0) / v.length).toFixed(3);
console.log(`distance same person ${mean(same)}, different people ${mean(diff)}`);
console.log(`brightness: ${labelled.map((x) => `${x.d.truth}${x.d.brightness.toFixed(0)}`).join(' ')}`);
