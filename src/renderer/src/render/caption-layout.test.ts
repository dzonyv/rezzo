import { describe, expect, it } from 'vitest';
import { BUILT_IN_STYLES, DEFAULT_CAPTION_STYLE, MAX_ACTIVE_SCALE, type CaptionStyle } from '../../../shared/caption-style.ts';
import { BOX_PAD_X, layoutLine, overhang, POP_PEAK } from './caption-layout.ts';

const SPACE = 19;
/** Roughly "BUDEM NEVEROVATAN" and "U SVEMIRU." in Poppins Bold at 76 px. */
const LONG_LINE = [250, 560];
const SHORT_LINE = [40, 400];

/** How far word `i` reaches on each side when it's spoken, as the painter draws it. */
function activeHalf(w: number, style: CaptionStyle): number {
  const scale = style.activeScale * (style.mode === 'reveal' && style.entrance === 'pop' ? POP_PEAK : 1);
  const reach = Math.max(style.outline.width, style.highlight.kind === 'box' ? style.size * BOX_PAD_X : 0);
  return scale * (w / 2 + reach);
}

/** Gaps between drawn edges with each word spoken in turn; never smaller than between two words at normal size. */
function checkNoOverlap(widths: number[], style: CaptionStyle) {
  const { centers } = layoutLine(widths, SPACE, style);
  const idle = (i: number) => widths[i]! / 2 + style.outline.width;
  const normalGap = SPACE - 2 * style.outline.width;
  widths.forEach((w, a) => {
    for (const n of [a - 1, a + 1]) {
      if (n < 0 || n >= widths.length) continue;
      const gap = Math.abs(centers[n]! - centers[a]!) - activeHalf(w, style) - idle(n);
      expect(gap).toBeGreaterThanOrEqual(normalGap - 1e-9);
    }
  });
}

describe('layoutLine', () => {
  it('puts one space between words that do not grow', () => {
    const style = { ...DEFAULT_CAPTION_STYLE, activeScale: 1 };
    const { centers, width, reach } = layoutLine([100, 200, 50], SPACE, style);
    expect(width).toBe(350 + 2 * SPACE);
    expect(reach).toBe(width);
    expect(centers).toEqual([50 - width / 2, 100 + SPACE + 100 - width / 2, 300 + 2 * SPACE + 25 - width / 2]);
  });

  it('is centred on 0', () => {
    const { centers, width } = layoutLine(LONG_LINE, SPACE, DEFAULT_CAPTION_STYLE);
    expect(centers[0]! - LONG_LINE[0]! / 2).toBeCloseTo(-width / 2);
    expect(centers[1]! + LONG_LINE[1]! / 2).toBeCloseTo(width / 2);
  });

  it('keeps a long spoken word off its neighbours with the default style', () => {
    checkNoOverlap(LONG_LINE, DEFAULT_CAPTION_STYLE);
    checkNoOverlap(SHORT_LINE, DEFAULT_CAPTION_STYLE);
  });

  it('keeps a long spoken word off its neighbours at the largest scale', () => {
    const style = { ...DEFAULT_CAPTION_STYLE, activeScale: MAX_ACTIVE_SCALE };
    checkNoOverlap([250, 560, 120], style);
    checkNoOverlap([560, 40], style);
  });

  it('leaves room for the box padding', () => {
    const box = BUILT_IN_STYLES.find((s) => s.id === 'box')!.style;
    checkNoOverlap(LONG_LINE, box);
    checkNoOverlap(LONG_LINE, { ...box, activeScale: MAX_ACTIVE_SCALE, outline: { color: '#000000', width: 12 } });
  });

  it('leaves room for the overshoot of a pop in reveal', () => {
    const reveal = BUILT_IN_STYLES.find((s) => s.id === 'reveal')!.style;
    checkNoOverlap([250, 560, 120], { ...reveal, activeScale: MAX_ACTIVE_SCALE });
    expect(overhang(500, { ...reveal, highlight: { ...reveal.highlight, kind: 'none' } })).toBeGreaterThan(0);
  });

  it('works for every built-in style', () => {
    for (const { style } of BUILT_IN_STYLES) checkNoOverlap([250, 560, 40, 300], style);
  });

  it('counts how far the end words can grow in the width the page fits by', () => {
    const style = { ...DEFAULT_CAPTION_STYLE, activeScale: MAX_ACTIVE_SCALE };
    const { width, reach } = layoutLine(LONG_LINE, SPACE, style);
    expect(reach).toBeCloseTo(width + overhang(LONG_LINE[0]!, style) + overhang(LONG_LINE[1]!, style));
  });

  it('does not grow words when nothing marks the spoken one', () => {
    const calm = BUILT_IN_STYLES.find((s) => s.id === 'calm')!.style;
    expect(overhang(560, { ...calm, activeScale: MAX_ACTIVE_SCALE })).toBe(0);
  });
});
