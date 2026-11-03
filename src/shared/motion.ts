/**
 * Where a layer (an image, later a video or an animation) sits in the output
 * and how it moves: its keyframed transform, plus preset animations for how
 * it comes in, goes out and moves while it's up. Pure and deterministic, so
 * the preview and the export put it in exactly the same place.
 */
import { z } from 'zod';
import { clamp01, easeInCubic, easeOutBack, easeOutBounce, easeOutCubic, noise } from './easing.ts';
import { valueAt } from './framing.ts';
import type { Animated } from './project.ts';

/** Largest scale: 1 is as wide as the output. */
export const MAX_LAYER_SCALE = 8;
export const MIN_LAYER_SCALE = 0.02;
/** How far a layer's centre may go past the output edges, as a share of the output. */
const OFF_EDGE = 1;

/**
 * Centre (0..1 across and down the output), size (1: as wide as the
 * output), rotation in degrees clockwise and opacity.
 */
export const transformSchema = z.object({
  x: z.number().min(-OFF_EDGE).max(1 + OFF_EDGE),
  y: z.number().min(-OFF_EDGE).max(1 + OFF_EDGE),
  scale: z.number().min(MIN_LAYER_SCALE).max(MAX_LAYER_SCALE),
  rotation: z.number().min(-720).max(720),
  opacity: z.number().min(0).max(1),
});
export type Transform = z.infer<typeof transformSchema>;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The transform kept inside the ranges a project file allows. */
export function clampTransform(t: Transform): Transform {
  return {
    x: clamp(t.x, -OFF_EDGE, 1 + OFF_EDGE),
    y: clamp(t.y, -OFF_EDGE, 1 + OFF_EDGE),
    scale: clamp(t.scale, MIN_LAYER_SCALE, MAX_LAYER_SCALE),
    rotation: clamp(t.rotation, -720, 720),
    opacity: clamp(t.opacity, 0, 1),
  };
}

export const ENTRANCES = ['none', 'fade', 'pop', 'slide', 'zoom', 'bounce'] as const;
export const EXITS = ['none', 'fade', 'pop', 'slide', 'zoom'] as const;
export const LOOPS = ['none', 'shake', 'pulse', 'kenBurns'] as const;
/** Where a slide comes from or goes to, and which way Ken Burns drifts. */
export const DIRECTIONS = ['left', 'right', 'up', 'down'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const MIN_MOTION_SECONDS = 0.05;
export const MAX_MOTION_SECONDS = 3;
const motionSeconds = z.number().min(MIN_MOTION_SECONDS).max(MAX_MOTION_SECONDS);

export const motionSchema = z.object({
  in: z.object({ kind: z.enum(ENTRANCES), direction: z.enum(DIRECTIONS), seconds: motionSeconds }),
  out: z.object({ kind: z.enum(EXITS), direction: z.enum(DIRECTIONS), seconds: motionSeconds }),
  /** `strength` 0..1 scales how much the layer moves. */
  loop: z.object({ kind: z.enum(LOOPS), direction: z.enum(DIRECTIONS), strength: z.number().min(0).max(1) }),
});
export type Motion = z.infer<typeof motionSchema>;

export const DEFAULT_MOTION: Motion = {
  in: { kind: 'pop', direction: 'left', seconds: 0.3 },
  out: { kind: 'none', direction: 'right', seconds: 0.3 },
  loop: { kind: 'none', direction: 'left', strength: 0.5 },
};

/** A pop starts (or ends) at this size. */
const POP_FROM = 0.7;
/** A bounce drops in from this far above, as a share of the output height. */
const BOUNCE_DROP = 0.25;
/** Shake: wobbles per second, how far (share of the output width) and how much it tilts at full strength. */
const SHAKE_RATE = 12;
const SHAKE_MOVE = 0.015;
const SHAKE_TILT = 3;
/** Pulse: one beat this long, growing by this much at full strength. */
const PULSE_SECONDS = 0.8;
const PULSE_GROWTH = 0.08;
/** Ken Burns: how much it grows and drifts over the layer's whole time at full strength. */
const KEN_BURNS_GROWTH = 0.25;
const KEN_BURNS_DRIFT = 0.08;

const STEP: Record<Direction, { x: number; y: number }> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

export interface Timed {
  start: number;
  end: number;
  transform: Animated<Transform>;
  motion: Motion;
}

/** The layer's transform at source time `t`, with its animations applied. */
export function layerTransformAt(layer: Timed, t: number): Transform {
  const base = valueAt(layer.transform, t);
  let { x, y, scale, rotation, opacity } = base;
  const { motion } = layer;
  const total = Math.max(layer.end - layer.start, 1e-6);
  const since = t - layer.start;
  const left = layer.end - t;

  // Coming in and going out share the layer's time if it's short.
  const inSeconds = Math.min(motion.in.seconds, total / 2);
  const outSeconds = Math.min(motion.out.seconds, total / 2);

  const f = clamp01(since / inSeconds);
  if (f < 1) {
    const step = STEP[motion.in.direction];
    switch (motion.in.kind) {
      case 'fade':
        opacity *= f;
        break;
      case 'pop':
        scale *= POP_FROM + (1 - POP_FROM) * easeOutBack(f);
        opacity *= clamp01(f * 3);
        break;
      case 'slide': {
        // From one output width (or height) away, in the chosen direction.
        const away = 1 - easeOutCubic(f);
        x += step.x * away;
        y += step.y * away;
        break;
      }
      case 'zoom':
        scale *= easeOutCubic(f);
        opacity *= clamp01(f * 2);
        break;
      case 'bounce':
        y -= (1 - easeOutBounce(f)) * BOUNCE_DROP;
        opacity *= clamp01(f * 4);
        break;
      case 'none':
        break;
    }
  }

  const g = clamp01(left / outSeconds);
  if (g < 1) {
    const step = STEP[motion.out.direction];
    switch (motion.out.kind) {
      case 'fade':
        opacity *= g;
        break;
      case 'pop':
        scale *= POP_FROM + (1 - POP_FROM) * easeOutCubic(g);
        opacity *= clamp01(g * 3);
        break;
      case 'slide': {
        const away = easeInCubic(1 - g);
        x += step.x * away;
        y += step.y * away;
        break;
      }
      case 'zoom':
        scale *= easeOutCubic(g);
        opacity *= clamp01(g * 2);
        break;
      case 'none':
        break;
    }
  }

  const s = motion.loop.strength;
  switch (motion.loop.kind) {
    case 'shake':
      x += noise(since * SHAKE_RATE, 1) * SHAKE_MOVE * s;
      y += noise(since * SHAKE_RATE, 2) * SHAKE_MOVE * s * (9 / 16);
      rotation += noise(since * SHAKE_RATE, 3) * SHAKE_TILT * s;
      break;
    case 'pulse':
      scale *= 1 + PULSE_GROWTH * s * (1 - Math.cos((2 * Math.PI * since) / PULSE_SECONDS)) * 0.5;
      break;
    case 'kenBurns': {
      const p = clamp01(since / total);
      const step = STEP[motion.loop.direction];
      scale *= 1 + KEN_BURNS_GROWTH * s * p;
      x += step.x * KEN_BURNS_DRIFT * s * (p - 0.5);
      y += step.y * KEN_BURNS_DRIFT * s * (p - 0.5);
      break;
    }
    case 'none':
      break;
  }

  return { x, y, scale: Math.max(0, scale), rotation, opacity: clamp01(opacity) };
}
