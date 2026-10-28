/** Box helpers for the face spike: tiling, merging and frame-to-frame tracking. */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Scored extends Box {
  score: number;
}

export function iou(a: Box, b: Box): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Intersection over the smaller box: 1 when one box lies inside the other. */
export function containment(a: Box, b: Box): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const smaller = Math.min(a.w * a.h, b.w * b.h);
  return smaller > 0 ? inter / smaller : 0;
}

/**
 * Keeps the highest-scoring box of every group of overlapping boxes. Boxes
 * mostly inside another one count as overlapping too: a tile edge that cuts
 * a face produces a half-face box next to the full one.
 */
export function nms<T extends Scored>(boxes: T[], threshold = 0.3): T[] {
  const kept: T[] = [];
  for (const b of [...boxes].sort((p, q) => q.score - p.score)) {
    if (kept.every((k) => iou(k, b) <= threshold && containment(k, b) <= 0.6)) kept.push(b);
  }
  return kept;
}

/**
 * Overlapping tiles in `rows` rows, so a face is never cut by every tile it
 * touches. 16:9 1080p with 2 rows -> 3x2 tiles of 810x648.
 */
export function tiles(width: number, height: number, rows = 2, overlap = 0.2): Box[] {
  const tileH = height / (rows - (rows - 1) * overlap);
  const cols = Math.max(1, Math.round(width / tileH));
  const tileW = cols === 1 ? width : width / (cols - (cols - 1) * overlap);
  const out: Box[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        x: Math.round(c * tileW * (1 - overlap)),
        y: Math.round(r * tileH * (1 - overlap)),
        w: Math.round(tileW),
        h: Math.round(tileH),
      });
    }
  }
  return out;
}

/** Square crop around a face, `scale` times its larger side, clamped to the frame. */
export function cropAround(face: Box, width: number, height: number, scale = 2): Box {
  const side = Math.min(Math.max(face.w, face.h) * scale, width, height);
  const cx = face.x + face.w / 2;
  const cy = face.y + face.h / 2;
  return {
    x: Math.round(Math.min(Math.max(cx - side / 2, 0), width - side)),
    y: Math.round(Math.min(Math.max(cy - side / 2, 0), height - side)),
    w: Math.round(side),
    h: Math.round(side),
  };
}

/**
 * Head box from MediaPipe pose landmarks (normalized). Points 0-10 are the
 * nose, eyes, ears and mouth corners; 11/12 the shoulders. The ears give the
 * head width when the person faces the camera; in profile they overlap, so
 * shoulder width is the fallback.
 */
export function headFromPose(lm: { x: number; y: number }[], width: number, height: number): Box | undefined {
  if (lm.length < 13) return undefined;
  const p = (i: number) => ({ x: lm[i].x * width, y: lm[i].y * height });
  const d = (a: number, b: number) => Math.hypot(p(a).x - p(b).x, p(a).y - p(b).y);
  const head = Array.from({ length: 11 }, (_, i) => p(i));
  const cx = head.reduce((s, q) => s + q.x, 0) / head.length;
  const cy = head.reduce((s, q) => s + q.y, 0) / head.length;
  const side = 1.4 * Math.max(d(7, 8), 0.45 * d(11, 12), 2.2 * d(2, 5));
  if (side < 8) return undefined;
  return { x: cx - side / 2, y: cy - side * 0.55, w: side, h: side };
}

/**
 * Greedy IoU tracker. A face keeps its id while it overlaps its previous box;
 * tracks survive a few missed frames; a camera cut ends all tracks.
 */
export class Tracker {
  private tracks: { id: number; box: Box; missed: number }[] = [];
  private nextId = 1;
  private readonly maxMissed: number;
  private readonly minIou: number;

  constructor(maxMissed = 5, minIou = 0.2) {
    this.maxMissed = maxMissed;
    this.minIou = minIou;
  }

  cut(): void {
    this.tracks = [];
  }

  update(boxes: Box[]): number[] {
    const ids = new Array<number>(boxes.length).fill(0);
    const free = new Set(this.tracks.map((_, i) => i));
    const pairs: [number, number, number][] = [];
    boxes.forEach((b, bi) => this.tracks.forEach((t, ti) => {
      const o = iou(b, t.box);
      if (o >= this.minIou) pairs.push([o, bi, ti]);
    }));
    pairs.sort((p, q) => q[0] - p[0]);
    for (const [, bi, ti] of pairs) {
      if (ids[bi] || !free.has(ti)) continue;
      ids[bi] = this.tracks[ti].id;
      this.tracks[ti].box = boxes[bi];
      this.tracks[ti].missed = 0;
      free.delete(ti);
    }
    for (const ti of free) this.tracks[ti].missed++;
    this.tracks = this.tracks.filter((t) => t.missed <= this.maxMissed);
    boxes.forEach((b, bi) => {
      if (!ids[bi]) {
        ids[bi] = this.nextId++;
        this.tracks.push({ id: ids[bi], box: b, missed: 0 });
      }
    });
    return ids;
  }
}
