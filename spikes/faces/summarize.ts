/**
 * Summarizes the face lab output per clip.
 *
 *   node faces/summarize.ts
 *
 * Prints how often each method found a face, how many faces per frame, the
 * sizes of the faces found, landmark success on crops, time per frame, and
 * the detected cuts. Writes <media>/faces/summary.json.
 */
import { readdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mediaDir } from '../shared/paths.ts';

interface Face {
  id: number;
  box: { x: number; y: number; w: number; h: number };
  foundBy: string[];
  landmarks: boolean;
  mouthOpen: number | null;
}
interface Frame {
  t: number;
  diff: number;
  cut: boolean;
  fullCount: number;
  naiveCount: number;
  tile2Count: number;
  tile4Count: number;
  faces: Face[];
  rejected: Face[];
  liteCount: number;
  heads: { id: number; box: Face['box']; landmarks: boolean; mouthOpen: number | null; matchesFace: boolean }[];
  ms: { full: number; naive: number; tiles2: number; tiles4: number; crops: number; poseLite: number; poseFull: number; headCrops: number };
}

const dir = path.join(mediaDir, 'faces');
const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(0)}%`;
const quantile = (xs: number[], q: number) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

const summaries = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'summary.json' && f !== 'speakers.json')) {
  const { clip, width, height, frames } = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as {
    clip: string; width: number; height: number; frames: Frame[];
  };
  const n = frames.length;
  const faces = frames.flatMap((f) => f.faces);
  const tilesOnly = faces.filter((f) => !f.foundBy.includes('full'));
  const fineOnly = faces.filter((f) => f.foundBy.length === 1 && f.foundBy[0] === 'tiles4');
  const counts = [0, 1, 2, 3].map((c) => frames.filter((f) => (c < 3 ? f.faces.length === c : f.faces.length >= 3)).length);
  const trackLengths = new Map<number, number>();
  for (const f of faces) trackLengths.set(f.id, (trackLengths.get(f.id) ?? 0) + 1);

  const s = {
    clip,
    size: `${width}x${height}`,
    frames: n,
    anyFace: {
      full: pct(frames.filter((f) => f.faces.some((x) => x.foundBy.includes('full'))).length, n),
      naive: pct(frames.filter((f) => f.naiveCount > 0).length, n),
      verified: pct(frames.filter((f) => f.faces.length > 0).length, n),
    },
    facesPerFrame: { none: pct(counts[0], n), one: pct(counts[1], n), two: pct(counts[2], n), threePlus: pct(counts[3], n) },
    faceHeightPx: { min: quantile(faces.map((f) => f.box.h), 0), median: quantile(faces.map((f) => f.box.h), 0.5), tilesOnlyMedian: quantile(tilesOnly.map((f) => f.box.h), 0.5) },
    foundOnlyByTiles: pct(tilesOnly.length, faces.length || 1),
    foundOnlyByFineTiles: pct(fineOnly.length, faces.length || 1),
    rejectedPerFrame: +mean(frames.map((f) => f.rejected.length)).toFixed(2),
    msPerFrame: {
      full: +mean(frames.map((f) => f.ms.full)).toFixed(1),
      naive: +mean(frames.map((f) => f.ms.naive)).toFixed(1),
      tiles2: +mean(frames.map((f) => f.ms.tiles2)).toFixed(1),
      tiles4: +mean(frames.map((f) => f.ms.tiles4)).toFixed(1),
      crops: +mean(frames.map((f) => f.ms.crops)).toFixed(1),
    },
    pose: {
      anyPersonLite: pct(frames.filter((f) => f.liteCount > 0).length, n),
      anyPersonFull: pct(frames.filter((f) => f.heads.length > 0).length, n),
      headsPerFrame: { none: pct(frames.filter((f) => f.heads.length === 0).length, n), one: pct(frames.filter((f) => f.heads.length === 1).length, n), two: pct(frames.filter((f) => f.heads.length === 2).length, n), threePlus: pct(frames.filter((f) => f.heads.length >= 3).length, n) },
      mouthOnHeads: pct(frames.flatMap((f) => f.heads).filter((h) => h.landmarks).length, frames.flatMap((f) => f.heads).length || 1),
      headHeightMedian: quantile(frames.flatMap((f) => f.heads).map((h) => h.box.h), 0.5),
      headTracks: new Set(frames.flatMap((f) => f.heads).map((h) => h.id)).size,
      ms: { lite: +mean(frames.map((f) => f.ms.poseLite)).toFixed(1), full: +mean(frames.map((f) => f.ms.poseFull)).toFixed(1), crops: +mean(frames.map((f) => f.ms.headCrops)).toFixed(1) },
    },
    tracks: { count: trackLengths.size, longestSeconds: Math.max(0, ...trackLengths.values()) / 10 },
    cuts: frames.filter((f) => f.cut).map((f) => f.t),
    topDiffs: [...frames].sort((a, b) => b.diff - a.diff).slice(0, 12).map((f) => `${f.t}s:${f.diff}`),
  };
  summaries.push(s);
  console.log(JSON.stringify(s, null, 1));
}

await writeFile(path.join(dir, 'summary.json'), JSON.stringify(summaries, null, 2));
