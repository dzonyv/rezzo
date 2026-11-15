/**
 * Where the words of a caption page go, apart from drawing them. Pure, so
 * it can be tested without a canvas: the painter passes in measured widths.
 *
 * The spoken word is drawn bigger (`activeScale`, and in reveal a pop that
 * overshoots a little), around its own middle. One space between words isn't
 * enough room for that: a long word grows past it and covers its neighbour.
 * So each gap is a space plus however far the bigger of its two words can
 * grow past its normal outline. The layout never depends on which word is
 * spoken, so nothing moves when the spoken word changes; the cost is that
 * gaps next to long words are a little wider.
 */
import { easeOutBack } from '../../../shared/easing.ts';
import type { CaptionStyle } from '../../../shared/caption-style.ts';

/** A pop starts at this size. */
export const POP_FROM = 0.7;

/** The largest a popping word gets, at easeOutBack's overshoot. */
export const POP_PEAK = (() => {
  let peak = 1;
  for (let i = 0; i <= 1000; i++) peak = Math.max(peak, POP_FROM + (1 - POP_FROM) * easeOutBack(i / 1000));
  return peak;
})();

/** How far the box highlight reaches past a word, as a share of the caption size. */
export const BOX_PAD_X = 0.2;
export const BOX_PAD_Y = 0.06;

export type LayoutStyle = Pick<CaptionStyle, 'size' | 'outline' | 'highlight' | 'mode' | 'entrance' | 'activeScale'>;

export interface LineLayout {
  /** Each word's middle, from the line's middle. */
  centers: number[];
  /** From the left edge of the first word to the right edge of the last, at normal size. */
  width: number;
  /** The width the line can take up: `width` plus how far its first and last word can grow out past the ends. */
  reach: number;
}

/** The most a word grows past its normal outline on each side, when it's the one being spoken. */
export function overhang(width: number, style: LayoutStyle): number {
  const marked = style.highlight.kind !== 'none';
  const scale = (marked ? style.activeScale : 1) * (style.mode === 'reveal' && style.entrance === 'pop' ? POP_PEAK : 1);
  // The outline reaches its width past the letters; a box reaches its padding.
  const reach = Math.max(style.outline.width, style.highlight.kind === 'box' ? style.size * BOX_PAD_X : 0);
  return Math.max(0, scale * (width / 2 + reach) - (width / 2 + style.outline.width));
}

/** One line's words, centred on 0, with room for any of them to be the spoken word. */
export function layoutLine(widths: readonly number[], space: number, style: LayoutStyle): LineLayout {
  const grow = widths.map((w) => overhang(w, style));
  const centers: number[] = [];
  let x = 0;
  widths.forEach((w, i) => {
    if (i > 0) x += space + Math.max(grow[i - 1]!, grow[i]!);
    centers.push(x + w / 2);
    x += w;
  });
  const width = x;
  const reach = width + (grow.length ? grow[0]! + grow[grow.length - 1]! : 0);
  return { centers: centers.map((c) => c - width / 2), width, reach };
}
