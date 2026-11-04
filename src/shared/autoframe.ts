/**
 * Automatic framing: who to look at (shared/speakers.ts) turned into plain
 * keyframes, which the user can then edit like their own. Nothing in the
 * export knows about this.
 *
 * It works in two steps. Scenes decide what the picture shows and when it
 * changes: one person, two stacked, or the whole frame. Then a virtual
 * camera follows the head through each scene. The analysis is offline, so
 * the camera doesn't lag: it sees where the head is going.
 */
import { seatBoxAt, type ClipAnalysis, type Seat } from './analysis.ts';
import { clampCrop, cropRect, regions, setKey, valueAt, type Rect, type Size } from './framing.ts';
import { sameFrame, snapToFrame, type FrameRate } from './frames.ts';
import { centreOf, sizeOf } from './heads.ts';
import { MAX_ZOOM, type Animated, type Crop, type Key, type Layout, type VideoLayer } from './project.ts';
import type { Stretch } from './speakers.ts';
import type { Span } from './voices.ts';

export const FRAME_WIDTHS = ['tight', 'medium', 'wide'] as const;
export type FrameWidth = (typeof FRAME_WIDTHS)[number];

export const SPEAKER_CHANGES = ['cut', 'pan'] as const;
export type SpeakerChange = (typeof SPEAKER_CHANGES)[number];

export interface AutoFrameOptions {
  width: FrameWidth;
  /** How the picture goes from one person to another in the same shot. */
  change: SpeakerChange;
}

/** How much of the picture's width a head takes. */
const HEAD_SHARE: Record<FrameWidth, number> = { tight: 0.5, medium: 0.36, wide: 0.25 };
/** Where the middle of the head sits, from the top of the picture. */
const HEAD_HEIGHT = 0.38;
/** The picture isn't blown up more than this many output pixels per source pixel: past it, a tighter crop only looks worse. */
const MAX_UPSCALE = 5;

/** Nothing shorter stays on screen: an interjection doesn't move the picture. */
const MIN_HOLD = 1.5;
/** This many changes of person within BUSY_SECONDS show both people instead. */
const BUSY_CHANGES = 3;
const BUSY_SECONDS = 6;
/** How long a pan from one person to the other takes. */
const PAN_SECONDS = 0.8;

/** The head can wander this share of the picture from where the camera points before it moves. */
const DEAD_ZONE = 0.12;
/** Seconds either side the camera's path is averaged over. */
const SETTLE = 1;
/** Seconds between the points of the camera's path. */
const STEP = 0.1;
/** A camera move smaller than this, in output pixels, isn't worth a keyframe. */
const TOLERANCE = 12;
/** A step of the path smaller than this, in output pixels, is the camera at rest. */
const STILL = 0.2;

type View = { kind: 'seat'; seat: number } | { kind: 'split'; top: number; bottom: number } | { kind: 'full' };

interface Scene extends Span {
  shot: number;
  view: View;
}

const sameView = (a: View, b: View) => JSON.stringify(a) === JSON.stringify(b);

function joined(scenes: readonly Scene[]): Scene[] {
  const out: Scene[] = [];
  for (const scene of scenes) {
    const last = out.at(-1);
    if (last && sameView(last.view, scene.view)) last.end = scene.end;
    else out.push({ ...scene });
  }
  return out;
}

/** The stretches of a shot where the talk goes back and forth too fast to follow. */
function busyStretches(scenes: readonly Scene[]): Span[] {
  const changes = scenes.slice(1).flatMap((s, i) => (s.view.kind === 'seat' && scenes[i]!.view.kind === 'seat' ? [s.start] : []));
  const busy: Span[] = [];
  changes.forEach((start, i) => {
    const end = changes[i + BUSY_CHANGES - 1];
    if (end === undefined || end - start > BUSY_SECONDS) return;
    const last = busy.at(-1);
    if (last && last.end >= start) last.end = end;
    else busy.push({ start, end });
  });
  return busy;
}

/** The scenes with both people shown in the busy stretches. Seats are left to right, so the left one goes on top. */
function withSplits(scenes: readonly Scene[], seats: readonly Seat[]): Scene[] {
  const busy = busyStretches(scenes);
  if (busy.length === 0) return [...scenes];
  const shot = scenes[0]!.shot;
  const out: Scene[] = [];
  let from = scenes[0]!.start;
  for (const stretch of busy) {
    const inside = scenes.filter((s) => s.end > stretch.start && s.start < stretch.end);
    const talking = seats.filter((seat) => inside.some((s) => s.view.kind === 'seat' && s.view.seat === seat.id));
    for (const s of scenes) if (s.end > from && s.start < stretch.start) out.push({ ...s, start: Math.max(s.start, from), end: Math.min(s.end, stretch.start) });
    out.push({ ...stretch, shot, view: { kind: 'split', top: talking[0]!.id, bottom: talking.at(-1)!.id } });
    from = stretch.end;
  }
  for (const s of scenes) if (s.end > from) out.push({ ...s, start: Math.max(s.start, from) });
  return out;
}

/** Scenes too short to stay on screen join the one before; a short first one joins the next. */
function held(scenes: readonly Scene[]): Scene[] {
  const out: Scene[] = [];
  for (const scene of scenes) {
    const last = out.at(-1);
    if (last && (scene.end - scene.start < MIN_HOLD || sameView(last.view, scene.view))) last.end = scene.end;
    else out.push({ ...scene });
  }
  if (out.length > 1 && out[0]!.end - out[0]!.start < MIN_HOLD) {
    out[1]!.start = out[0]!.start;
    out.shift();
  }
  return out;
}

/** What the picture shows from the start of the range to its end. A camera cut always ends a scene. */
function scenesOf(analysis: ClipAnalysis, stretches: readonly Stretch[], range: Span): Scene[] {
  return analysis.shots.flatMap((shot, s) => {
    const seats = analysis.seats.filter((seat) => seat.shot === s);
    const parts = stretches.flatMap((stretch): Scene[] => {
      const start = Math.max(stretch.start, shot.start, range.start);
      const end = Math.min(stretch.end, shot.end, range.end);
      if (end <= start) return [];
      const { target } = stretch;
      const view: View =
        target.kind === 'seat'
          ? { kind: 'seat', seat: target.seat }
          : target.kind === 'group'
            ? { kind: 'split', top: seats[0]!.id, bottom: seats.at(-1)!.id }
            : { kind: 'full' };
      return [{ start, end, shot: s, view }];
    });
    return parts.length === 0 ? [] : held(withSplits(joined(parts), seats));
  });
}

interface Point {
  t: number;
  x: number;
  y: number;
}

/**
 * The moments that matter on the camera's path: where it starts, where each
 * move begins and ends, and where it ends. The path rests between moves, so
 * a keyframe at each end of a move plays it back as one eased motion, where
 * keyframes along the way would make it stop at each one. `size` measures a
 * step in output pixels; a move smaller than TOLERANCE doesn't count.
 */
function restsOf(path: readonly Point[], size: (dx: number, dy: number) => number): Point[] {
  const between = (a: Point, b: Point) => size(b.x - a.x, b.y - a.y);
  const moves: [Point, Point][] = [];
  let from: Point | null = null;
  path.forEach((p, i) => {
    const prev = path[i - 1];
    if (!prev) return;
    const before = path[i - 2];
    const moving = between(prev, p) > STILL;
    const turned = before !== undefined && (prev.x - before.x) * (p.x - prev.x) + (prev.y - before.y) * (p.y - prev.y) < 0;
    if (from && (!moving || turned)) {
      moves.push([from, prev]);
      from = null;
    }
    if (moving && !from) from = prev;
  });
  if (from) moves.push([from, path.at(-1)!]);
  const points = [path[0]!, ...moves.filter(([a, b]) => between(a, b) > TOLERANCE).flat(), path.at(-1)!];
  return points.filter((p, i) => p !== points[i - 1]);
}

/**
 * The zoom that gives heads of these seats their share of the picture. One
 * for a whole scene, so it doesn't pump, and one for both halves of Split, so
 * two people sitting together look the same size.
 */
function zoomFor(seats: readonly Seat[], region: Rect, source: Size, width: FrameWidth): number {
  const full = cropRect({ x: 0.5, y: 0.5, zoom: 1 }, region.w / region.h, source);
  const head = seats.reduce((sum, seat) => sum + sizeOf(seat.box), 0) / seats.length;
  const sharpest = (full.w * source.width * MAX_UPSCALE) / region.w;
  return Math.max(1, Math.min(MAX_ZOOM, sharpest, (full.w * HEAD_SHARE[width] * source.width) / head));
}

/**
 * Keyframes for a camera following a seat over `span`: it stays put while
 * the head is near the middle, goes after it when it isn't, and the path is
 * then averaged in both directions, which is what makes it smooth with no
 * lag. Each ends with a key that eases on (`eases`) or holds.
 */
function cameraKeys(seat: Seat, span: Span, region: Rect, source: Size, zoom: number, eases: boolean): Key<Crop>[] {
  const aspect = region.w / region.h;
  const { w, h } = cropRect({ x: 0.5, y: 0.5, zoom }, aspect, source);
  const wanted = (t: number) => {
    const c = centreOf(seatBoxAt(seat, t));
    return { x: c.x / source.width, y: c.y / source.height + (0.5 - HEAD_HEIGHT) * h };
  };

  const steps = Math.max(1, Math.round((span.end - span.start) / STEP));
  const times = Array.from({ length: steps + 1 }, (_, i) => span.start + ((span.end - span.start) * i) / steps);
  let camera = wanted(span.start);
  const path = times.map((t) => {
    const head = wanted(t);
    const dx = DEAD_ZONE * w;
    const dy = DEAD_ZONE * h;
    camera = { x: Math.min(head.x + dx, Math.max(head.x - dx, camera.x)), y: Math.min(head.y + dy, Math.max(head.y - dy, camera.y)) };
    return { t, ...camera };
  });
  const reach = Math.round(SETTLE / STEP);
  const smooth = path.map((p, i) => {
    const near = path.slice(Math.max(0, i - reach), i + reach + 1);
    return { t: p.t, x: near.reduce((s, q) => s + q.x, 0) / near.length, y: near.reduce((s, q) => s + q.y, 0) / near.length };
  });

  const size = (dx: number, dy: number) => Math.max((Math.abs(dx) / w) * region.w, (Math.abs(dy) / h) * region.h);
  const points = restsOf(smooth, size);
  const still = points.length === 2 && size(points[1]!.x - points[0]!.x, points[1]!.y - points[0]!.y) <= TOLERANCE;
  // One that eases on needs its last key: that's where the pan starts.
  const kept = still && !eases ? points.slice(0, 1) : points;
  return kept.map((p, i) => ({
    t: p.t,
    value: clampCrop({ x: p.x, y: p.y, zoom }, aspect, source),
    ease: i < kept.length - 1 || eases ? ('smooth' as const) : ('cut' as const),
  }));
}

/** What's left of a scene for its camera with this much off each end. A scene of a frame or two has only its start. */
function spanOf(scene: Scene, before: number, after: number): Span {
  const start = scene.start + before;
  return { start, end: Math.max(start, scene.end - after) };
}

/** Keys on the frame grid; of two on one frame the later one stays. */
function onFrames<T>(keys: readonly Key<T>[], rate: FrameRate): Animated<T> {
  const snapped = keys.map((k) => ({ ...k, t: snapToFrame(k.t, rate) }));
  return snapped.filter((k, i) => i === snapped.length - 1 || !sameFrame(k.t, snapped[i + 1]!.t, rate));
}

export type AutoFramed = Pick<VideoLayer, 'layout' | 'follow' | 'splitTop' | 'splitBottom'>;

/**
 * The framing for `range`. A track comes back empty when the range has no
 * use for it, and the Full layout's own framing is left to the user.
 */
export function autoFrame(analysis: ClipAnalysis, stretches: readonly Stretch[], range: Span, options: AutoFrameOptions, rate: FrameRate): AutoFramed {
  const source: Size = { width: analysis.width, height: analysis.height };
  const seat = (id: number) => analysis.seats.find((s) => s.id === id)!;
  const [whole] = regions('follow');
  const [top, bottom] = regions('split');
  const scenes = scenesOf(analysis, stretches, range);

  const layout: Key<Layout>[] = [];
  const follow: Key<Crop>[] = [];
  const splitTop: Key<Crop>[] = [];
  const splitBottom: Key<Crop>[] = [];
  /** A pan joins two scenes of one person each in the same shot. */
  const pans = (a: Scene | undefined, b: Scene | undefined) => options.change === 'pan' && a?.shot === b?.shot && a?.view.kind === 'seat' && b?.view.kind === 'seat';

  scenes.forEach((scene, i) => {
    const { view } = scene;
    const kind: Layout = view.kind === 'seat' ? 'follow' : view.kind;
    if (layout.at(-1)?.value !== kind) layout.push({ t: scene.start, value: kind, ease: 'cut' });
    if (view.kind === 'seat') {
      const panIn = pans(scenes[i - 1], scene);
      const panOut = pans(scene, scenes[i + 1]);
      const span = spanOf(scene, panIn ? PAN_SECONDS / 2 : 0, panOut ? PAN_SECONDS / 2 : STEP);
      follow.push(...cameraKeys(seat(view.seat), span, whole!, source, zoomFor([seat(view.seat)], whole!, source, options.width), panOut));
    } else if (view.kind === 'split') {
      const span = spanOf(scene, 0, STEP);
      const zoom = zoomFor([seat(view.top), seat(view.bottom)], top!, source, options.width);
      splitTop.push(...cameraKeys(seat(view.top), span, top!, source, zoom, false));
      splitBottom.push(...cameraKeys(seat(view.bottom), span, bottom!, source, zoom, false));
    }
  });

  return { layout: onFrames(layout, rate), follow: onFrames(follow, rate), splitTop: onFrames(splitTop, rate), splitBottom: onFrames(splitBottom, rate) };
}

/**
 * Puts `next` where the keyframes of `range` were. Past the range the
 * picture goes on as it did, unless `toEnd` says the range runs to the end
 * of the clip. With nothing new for this track, it stays as it is.
 */
export function spliceKeys<T>(keys: Animated<T>, range: Span, next: Animated<T>, toEnd: boolean, rate: FrameRate): Animated<T> {
  if (next.length === 0) return keys;
  const marked = toEnd ? keys : setKey(keys, range.end, valueAt(keys, range.end), rate);
  const before = marked.filter((k) => k.t < range.start && !sameFrame(k.t, range.start, rate));
  const after = toEnd ? [] : marked.filter((k) => (k.t >= range.end || sameFrame(k.t, range.end, rate)) && !sameFrame(k.t, next.at(-1)!.t, rate));
  // The last one before the range mustn't ease into something it knows nothing about.
  return [...before.map((k, i) => (i === before.length - 1 ? { ...k, ease: 'cut' as const } : k)), ...next, ...after];
}

/** The clip's framing with `framed` put in over `range`. */
export function withAutoFrame(layer: VideoLayer, framed: AutoFramed, range: Span, toEnd: boolean, rate: FrameRate): AutoFramed {
  const layout = spliceKeys(layer.layout, range, framed.layout, toEnd, rate);
  return {
    layout: layout.filter((k, i) => i === 0 || k.value !== layout[i - 1]!.value),
    follow: spliceKeys(layer.follow, range, framed.follow, toEnd, rate),
    splitTop: spliceKeys(layer.splitTop, range, framed.splitTop, toEnd, rate),
    splitBottom: spliceKeys(layer.splitBottom, range, framed.splitBottom, toEnd, rate),
  };
}
