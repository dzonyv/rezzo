import { describe, expect, it } from 'vitest';
import { applyChromaKey, chromaOf, DEFAULT_CHROMA_KEY, rgbOf } from './chroma-key.ts';

const green = DEFAULT_CHROMA_KEY;

describe('chroma key', () => {
  it('reads hex colours', () => {
    expect(rgbOf('#00ff00')).toEqual([0, 1, 0]);
    expect(rgbOf('#ff8000')).toEqual([1, 128 / 255, 0]);
  });

  it('gives grey no colour difference', () => {
    const [cb, cr] = chromaOf(0.4, 0.4, 0.4);
    expect(cb).toBeCloseTo(0);
    expect(cr).toBeCloseTo(0);
  });

  it('removes the key colour and its shadows, keeps other colours', () => {
    expect(applyChromaKey([0, 1, 0], green).alpha).toBe(0);
    // The screen in shadow: darker, same hue.
    expect(applyChromaKey([0.05, 0.45, 0.08], green).alpha).toBe(0);
    expect(applyChromaKey([1, 0, 0], green).alpha).toBe(1);
    // Skin and white stay.
    expect(applyChromaKey([0.9, 0.7, 0.6], green).alpha).toBe(1);
    expect(applyChromaKey([1, 1, 1], green).alpha).toBe(1);
  });

  it('fades between similarity and similarity + smoothness', () => {
    const key = { ...green, similarity: 0.2, smoothness: 0.2 };
    const alphas = [0, 0.25, 0.5, 0.75, 1].map((t) => applyChromaKey([t, 1 - t * 0.5, t], key).alpha);
    // Moving away from green, alpha only grows.
    for (let i = 1; i < alphas.length; i++) expect(alphas[i]!).toBeGreaterThanOrEqual(alphas[i - 1]!);
    expect(alphas[0]).toBe(0);
    expect(alphas.at(-1)).toBe(1);
    expect(alphas.some((a) => a > 0 && a < 1)).toBe(true);
  });

  it('is a hard cut without smoothness', () => {
    const key = { ...green, smoothness: 0 };
    for (const rgb of [[0, 1, 0], [0.3, 0.6, 0.3], [1, 0, 0]] as const) expect([0, 1]).toContain(applyChromaKey(rgb, key).alpha);
  });

  it('takes the green tint out of what stays, keeping brightness', () => {
    const fringe: [number, number, number] = [0.6, 0.8, 0.6];
    const none = applyChromaKey(fringe, { ...green, spill: 0 }).rgb;
    const full = applyChromaKey(fringe, { ...green, spill: 1 }).rgb;
    expect(none[0]).toBeCloseTo(0.6);
    expect(none[1]).toBeCloseTo(0.8);
    expect(full[1] - full[0]).toBeLessThan(none[1] - none[0]);
    const luma = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    expect(luma(full)).toBeCloseTo(luma(fringe), 2);
    // A colour with no green in its tint isn't touched.
    expect(applyChromaKey([0.9, 0.2, 0.3], green).rgb.map((v) => +v.toFixed(4))).toEqual([0.9, 0.2, 0.3]);
  });
});
