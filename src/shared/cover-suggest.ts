/**
 * Moments worth a cover, from what the clip analysis already knows: the
 * camera cuts and the people in each shot (shared/analysis.ts). Faces
 * that are big and turned to the camera score well; frames right at a cut
 * (often half a dissolve) don't count. The renderer then decodes the best
 * few and keeps the sharpest (render/cover-suggest.ts).
 */
import { shotIndexAt, type ClipAnalysis } from './analysis.ts';
import type { Clip } from './project.ts';
import { keptPieces } from './skips.ts';

/** A moment and how good a cover it would make, 0..1. */
export interface CoverCandidate {
  t: number;
  score: number;
}

/** Frames this close to a camera cut are left out. */
const CUT_MARGIN = 0.3;
/** Two suggestions are at least this far apart, so they show different moments. */
const MIN_APART = 1;
/** A head this tall (a share of the frame's height) counts as a close-up: as big as it gets. */
const CLOSE_UP = 0.35;
/** How much of a frame's score its face being found (turned to the camera, big enough) adds. */
const FACE_SHARE = 0.3;
/** A frame nobody's found in still scores this, so a clip without people gets suggestions too. */
const NOBODY = 0.05;

/** Whether `t` is played and not right at a cut. */
function usable(clip: Pick<Clip, 'start' | 'end' | 'skips'>, analysis: ClipAnalysis, t: number): boolean {
  if (!keptPieces(clip).some((p) => t >= p.start && t < p.end)) return false;
  const shot = analysis.shots[shotIndexAt(analysis.shots, t)];
  if (!shot) return true;
  const nearStart = shot.start > clip.start && t - shot.start < CUT_MARGIN;
  const nearEnd = shot.end < clip.end && shot.end - t < CUT_MARGIN;
  return !nearStart && !nearEnd;
}

/**
 * Up to `count` moments of the clip to suggest for its cover, best first,
 * at least MIN_APART seconds from each other. A moment scores by the
 * biggest head on screen and whether its face was found; without anyone
 * found, the moments are spread evenly over the clip.
 */
export function coverCandidates(clip: Pick<Clip, 'start' | 'end' | 'skips'>, analysis: ClipAnalysis, count: number): CoverCandidate[] {
  const byTime = new Map<number, number>();
  for (const seat of analysis.seats) {
    for (const s of seat.samples) {
      if (!usable(clip, analysis, s.t)) continue;
      const size = Math.min(1, s.box.h / analysis.height / CLOSE_UP);
      const score = (1 - FACE_SHARE) * size + (s.mouth !== null ? FACE_SHARE : 0);
      byTime.set(s.t, Math.max(byTime.get(s.t) ?? 0, score));
    }
  }
  if (byTime.size === 0) {
    // Nobody found: moments spread over what the clip plays.
    const pieces = keptPieces(clip);
    const length = pieces.reduce((sum, p) => sum + p.end - p.start, 0);
    const spread: CoverCandidate[] = [];
    for (let i = 0; i < count; i++) {
      let at = (length * (i + 0.5)) / count;
      for (const p of pieces) {
        if (at < p.end - p.start) {
          const t = p.start + at;
          if (usable(clip, analysis, t)) spread.push({ t, score: NOBODY });
          break;
        }
        at -= p.end - p.start;
      }
    }
    return spread;
  }
  const ranked = [...byTime].map(([t, score]) => ({ t, score })).sort((a, b) => b.score - a.score || a.t - b.t);
  const picked: CoverCandidate[] = [];
  for (const c of ranked) {
    if (picked.length === count) break;
    if (picked.every((p) => Math.abs(p.t - c.t) >= MIN_APART)) picked.push(c);
  }
  return picked;
}

/**
 * How sharp a grey picture is (`width` × `height`, one byte a pixel): the
 * variance of its Laplacian. Motion blur and focus hunting bring it down;
 * only comparisons between frames of one clip mean anything.
 */
export function sharpness(grey: ArrayLike<number>, width: number, height: number): number {
  let sum = 0;
  let squares = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const l = grey[i - width]! + grey[i + width]! + grey[i - 1]! + grey[i + 1]! - 4 * grey[i]!;
      sum += l;
      squares += l * l;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return squares / n - mean * mean;
}

/**
 * The candidates ranked again with their sharpness (same order as
 * `candidates`), the sharpest counting fully and the blurriest half;
 * the best `count` of them, best first.
 */
export function rankWithSharpness(candidates: readonly CoverCandidate[], sharp: readonly number[], count: number): CoverCandidate[] {
  const most = Math.max(0, ...sharp);
  return candidates
    .map((c, i) => ({ t: c.t, score: c.score * (most > 0 ? 0.5 + 0.5 * (sharp[i]! / most) : 1) }))
    .sort((a, b) => b.score - a.score || a.t - b.t)
    .slice(0, count);
}
