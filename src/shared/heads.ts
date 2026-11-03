/**
 * Head geometry from MediaPipe's landmarks, in source pixels. Pose finds
 * people in profile and in wide shots, where face detectors don't
 * (spikes/REPORT.md, 0b); the Face Landmarker then runs on a crop around
 * each head for the mouth.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Heads smaller than this many pixels are noise. */
const MIN_HEAD = 8;

/**
 * Head box from pose landmarks (normalised 0..1). Points 0–10 are the nose,
 * eyes, ears and mouth corners; 11 and 12 the shoulders. The ears give the
 * head width when the person faces the camera; in profile they overlap, so
 * shoulder width and eye distance take over.
 */
export function headFromPose(landmarks: readonly Point[], width: number, height: number): Box | null {
  if (landmarks.length < 13) return null;
  const p = (i: number) => ({ x: landmarks[i]!.x * width, y: landmarks[i]!.y * height });
  const d = (a: number, b: number) => Math.hypot(p(a).x - p(b).x, p(a).y - p(b).y);
  let cx = 0;
  let cy = 0;
  for (let i = 0; i <= 10; i++) {
    cx += p(i).x / 11;
    cy += p(i).y / 11;
  }
  const side = 1.4 * Math.max(d(7, 8), 0.45 * d(11, 12), 2.2 * d(2, 5));
  if (side < MIN_HEAD) return null;
  return { x: cx - side / 2, y: cy - side * 0.55, w: side, h: side };
}

/** Square crop around a box, `scale` times its larger side, kept inside the frame. */
export function cropAround(box: Box, width: number, height: number, scale: number): Box {
  const side = Math.min(Math.max(box.w, box.h) * scale, width, height);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return {
    x: Math.round(Math.min(Math.max(cx - side / 2, 0), width - side)),
    y: Math.round(Math.min(Math.max(cy - side / 2, 0), height - side)),
    w: Math.round(side),
    h: Math.round(side),
  };
}

/**
 * How open the mouth is: the gap between the inner lips (Face Landmarker
 * points 13 and 14) over the face height (10 to 152).
 */
export function mouthOpening(face: readonly Point[]): number | null {
  if (face.length < 153) return null;
  const dist = (a: number, b: number) => Math.hypot(face[a]!.x - face[b]!.x, face[a]!.y - face[b]!.y);
  const height = dist(10, 152);
  return height > 0 ? dist(13, 14) / height : null;
}

export const centreOf = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
export const sizeOf = (b: Box): number => Math.max(b.w, b.h);
