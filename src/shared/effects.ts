/**
 * Effects: layers that change everything under them for part of a clip,
 * like adjustment layers. Each effect has an intensity with keyframes and a
 * few settings of its own. effectPassAt turns that into the numbers one
 * shader pass needs at a moment; it's pure, so the preview and the export
 * get exactly the same pass for the same frame.
 */
import { clamp01, easeOutCubic, noise, smoothstep } from './easing.ts';
import { valueAt } from './framing.ts';
import type { Animated } from './project.ts';

export const EFFECT_GROUPS = ['camera', 'flash', 'color', 'stylized'] as const;
export type EffectGroup = (typeof EFFECT_GROUPS)[number];

/** How a setting is shown: a share (percent), a zoom factor, seconds, times per second or pixels. */
export type ParamUnit = 'percent' | 'times' | 'seconds' | 'perSecond' | 'pixels';

export interface ParamDef {
  min: number;
  max: number;
  step: number;
  /** The setting a new effect starts with. */
  value: number;
  unit: ParamUnit;
}

interface EffectDef {
  group: EffectGroup;
  /** How long a new effect of this kind lasts. */
  seconds: number;
  params: Record<string, ParamDef>;
}

const amount = (value: number, min = 0): ParamDef => ({ min, max: 1, step: 0.01, value, unit: 'percent' });
const speed: ParamDef = { min: 2, max: 30, step: 1, value: 12, unit: 'perSecond' };

/** The library, in the order it's offered, grouped. */
export const EFFECTS = {
  zoomPunch: {
    group: 'camera',
    seconds: 1.5,
    params: {
      zoom: { min: 1.05, max: 2, step: 0.01, value: 1.3, unit: 'times' },
      /** How long the punch-in takes. */
      punch: { min: 0.05, max: 1, step: 0.05, value: 0.15, unit: 'seconds' },
      /** How long it takes to go back at the end; 0 holds the zoom to the end. */
      release: { min: 0, max: 1, step: 0.05, value: 0, unit: 'seconds' },
    },
  },
  shake: { group: 'camera', seconds: 1, params: { amount: amount(0.5), speed } },
  slowZoom: { group: 'camera', seconds: 3, params: { zoom: { min: 1.02, max: 1.5, step: 0.01, value: 1.15, unit: 'times' } } },
  flash: { group: 'flash', seconds: 0.4, params: {} },
  fadeOut: { group: 'flash', seconds: 1, params: {} },
  fadeIn: { group: 'flash', seconds: 1, params: {} },
  brightness: { group: 'color', seconds: 3, params: { amount: amount(0.3, -1) } },
  contrast: { group: 'color', seconds: 3, params: { amount: amount(0.3, -1) } },
  saturation: { group: 'color', seconds: 3, params: { amount: amount(0.5, -1) } },
  temperature: { group: 'color', seconds: 3, params: { amount: amount(0.5, -1) } },
  blackWhite: { group: 'color', seconds: 3, params: {} },
  blur: { group: 'stylized', seconds: 3, params: { amount: amount(0.5) } },
  vignette: { group: 'stylized', seconds: 3, params: { size: amount(0.5) } },
  glitch: { group: 'stylized', seconds: 1, params: { amount: amount(0.5), speed } },
  grain: { group: 'stylized', seconds: 3, params: { amount: amount(0.4), size: { min: 1, max: 4, step: 0.1, value: 1.5, unit: 'pixels' } } },
} as const satisfies Record<string, EffectDef>;

export type EffectName = keyof typeof EFFECTS;
export const EFFECT_NAMES = Object.keys(EFFECTS) as [EffectName, ...EffectName[]];

/** A new effect's settings. */
export function defaultParams(effect: EffectName): Record<string, number> {
  const defs: Record<string, ParamDef> = EFFECTS[effect].params;
  return Object.fromEntries(Object.entries(defs).map(([key, def]) => [key, def.value]));
}

/** Whether `params` has exactly the effect's settings, each in its range. */
export function paramsValid(effect: EffectName, params: Record<string, number>): boolean {
  const defs: Record<string, ParamDef> = EFFECTS[effect].params;
  const keys = Object.keys(params);
  return keys.length === Object.keys(defs).length && keys.every((k) => defs[k] !== undefined && params[k]! >= defs[k].min && params[k]! <= defs[k].max);
}

/** What an effect layer holds (see project.ts, effectLayerSchema). */
export interface EffectTiming {
  effect: EffectName;
  start: number;
  end: number;
  intensity: Animated<number>;
  params: Record<string, number>;
}

/**
 * One shader pass over everything drawn so far:
 * - camera: zoom about the centre, then a shift (share of the output) and a turn (radians, clockwise),
 * - tint: mix towards a colour (RGB 0..1),
 * - grade: brightness, contrast, saturation and temperature, each -1..1, 0 for no change,
 * - blur, vignette, glitch, grain: their strength 0..1 and settings; `seed` changes the noise.
 */
export type EffectPass =
  | { pass: 'camera'; zoom: number; x: number; y: number; rotation: number }
  | { pass: 'tint'; color: [number, number, number]; amount: number }
  | { pass: 'grade'; brightness: number; contrast: number; saturation: number; temperature: number }
  | { pass: 'blur'; amount: number }
  | { pass: 'vignette'; amount: number; size: number }
  | { pass: 'glitch'; amount: number; seed: number }
  | { pass: 'grain'; amount: number; size: number; seed: number };

/** Shake: how far it moves (share of the output width) and turns (degrees) at full strength. */
const SHAKE_MOVE = 0.02;
const SHAKE_TILT = 1.5;
/** Grain changes this many times a second, like film. */
const GRAIN_RATE = 24;
const NO_GRADE = { brightness: 0, contrast: 0, saturation: 0, temperature: 0 };

/**
 * The pass the effect makes at source time `t`, or null when it changes
 * nothing then (intensity 0, or nothing to do at this point of it).
 */
export function effectPassAt(layer: EffectTiming, t: number): EffectPass | null {
  const k = clamp01(valueAt(layer.intensity, t));
  if (k <= 0) return null;
  const defaults = defaultParams(layer.effect);
  const param = (key: string) => layer.params[key] ?? defaults[key] ?? 0;
  const total = Math.max(layer.end - layer.start, 1e-6);
  const since = Math.max(0, t - layer.start);
  const p = clamp01(since / total);

  switch (layer.effect) {
    case 'zoomPunch': {
      const punch = Math.min(param('punch'), total / 2);
      const release = Math.min(param('release'), total / 2);
      let f = easeOutCubic(clamp01(since / punch));
      if (release > 0) f *= smoothstep(clamp01((layer.end - t) / release));
      return camera(1 + (param('zoom') - 1) * k * f, 0, 0, 0);
    }
    case 'shake': {
      const a = param('amount') * k;
      const s = since * param('speed');
      // Zoomed in a little, so the edges never show while it moves.
      return camera(1 + 2.2 * SHAKE_MOVE * a, noise(s, 1) * SHAKE_MOVE * a, noise(s, 2) * SHAKE_MOVE * a * (9 / 16), (noise(s, 3) * SHAKE_TILT * a * Math.PI) / 180);
    }
    case 'slowZoom':
      return camera(1 + (param('zoom') - 1) * k * p, 0, 0, 0);
    case 'flash':
      return tint([1, 1, 1], k * (1 - p) ** 2);
    case 'fadeOut':
      return tint([0, 0, 0], k * smoothstep(p));
    case 'fadeIn':
      return tint([0, 0, 0], k * (1 - smoothstep(p)));
    case 'brightness':
      return { pass: 'grade', ...NO_GRADE, brightness: param('amount') * k };
    case 'contrast':
      return { pass: 'grade', ...NO_GRADE, contrast: param('amount') * k };
    case 'saturation':
      return { pass: 'grade', ...NO_GRADE, saturation: param('amount') * k };
    case 'temperature':
      return { pass: 'grade', ...NO_GRADE, temperature: param('amount') * k };
    case 'blackWhite':
      return { pass: 'grade', ...NO_GRADE, saturation: -k };
    case 'blur':
      return nonzero(param('amount') * k, (amount) => ({ pass: 'blur', amount }));
    case 'vignette':
      return { pass: 'vignette', amount: k, size: param('size') };
    case 'glitch':
      return nonzero(param('amount') * k, (amount) => ({ pass: 'glitch', amount, seed: Math.floor(since * param('speed')) }));
    case 'grain':
      return nonzero(param('amount') * k, (amount) => ({ pass: 'grain', amount, size: param('size'), seed: Math.floor(since * GRAIN_RATE) }));
  }
}

function camera(zoom: number, x: number, y: number, rotation: number): EffectPass | null {
  return zoom === 1 && x === 0 && y === 0 && rotation === 0 ? null : { pass: 'camera', zoom, x, y, rotation };
}

function tint(color: [number, number, number], amount: number): EffectPass | null {
  return amount > 0 ? { pass: 'tint', color, amount } : null;
}

const nonzero = (amount: number, pass: (amount: number) => EffectPass): EffectPass | null => (amount > 0 ? pass(amount) : null);
