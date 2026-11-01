/**
 * Draws a clip's captions for one moment onto a transparent 1080×1920
 * canvas with Canvas2D, which the compositor lays over the picture. The
 * preview and the export call the same code with the same time, so they
 * get the same pixels.
 *
 * Canvas2D rather than text in a shader: it gives kerning, diacritics and
 * outlines without a text renderer of our own.
 */
import { cssFont } from '../../../shared/fonts.ts';
import type { CaptionStyle } from '../../../shared/caption-style.ts';
import { OUTPUT, valueAt } from '../../../shared/framing.ts';
import { captionPages, captionStateAt, LINE_HEIGHT, pageLines, type CaptionPage, type CaptionState } from '../../../shared/captions.ts';
import type { Animated, CaptionLayer, Word } from '../../../shared/project.ts';
import { ensureFont } from '../fonts/registry.ts';

/** Captions keep this far from the left and right edges; a page too wide is drawn smaller. */
const SIDE_MARGIN = 60;
/** How long a page (or, in reveal, a word) takes to come in. */
const ENTRANCE_SECONDS = 0.18;
/** A pop starts at this size. */
const POP_FROM = 0.7;

export interface CaptionScene {
  pages: CaptionPage[];
  /** With the font it will be drawn in (see fonts/registry.ts). */
  style: CaptionStyle;
  y: Animated<number>;
}

/** What the compositor lays over the picture; `version` changes whenever the pixels do. */
export interface Overlay {
  image: TexImageSource;
  version: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Overshoots a little and settles, for the pop. */
function easeOutBack(f: number): number {
  const c = 1.7;
  return 1 + (c + 1) * (f - 1) ** 3 + c * (f - 1) ** 2;
}

/** Scale and opacity of something that started coming in `since` seconds ago. */
function entrance(style: CaptionStyle, since: number): { scale: number; alpha: number } {
  const f = clamp01(since / ENTRANCE_SECONDS);
  if (style.entrance === 'pop') return { scale: POP_FROM + (1 - POP_FROM) * easeOutBack(f), alpha: clamp01(f * 3) };
  if (style.entrance === 'fade') return { scale: 1, alpha: f };
  return { scale: 1, alpha: 1 };
}

/** Animation steps finer than this don't show; rounding to them lets a repaint be skipped. */
const step = (v: number) => Math.round(v * 256) / 256;

/**
 * Time into an entrance as it's drawn: rounded, and the same for any time
 * after it has finished. The repaint check and the drawing both use it, so
 * a frame looks the same however the painter got to it.
 */
const settle = (since: number) => step(Math.min(since, ENTRANCE_SECONDS));

export class CaptionPainter {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private scene: CaptionScene | null = null;
  private drawn = '';
  private version = 0;

  constructor() {
    // A canvas in the document (not an OffscreenCanvas) uses the fonts the document has loaded.
    this.canvas = document.createElement('canvas');
    this.canvas.width = OUTPUT.width;
    this.canvas.height = OUTPUT.height;
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** The captions at source time `t`, or null when none show. Repaints only when something changed. */
  paint(scene: CaptionScene, t: number): Overlay | null {
    const state = captionStateAt(scene.pages, t);
    if (!state) return null;
    const page = scene.pages[state.page]!;
    const { style } = scene;
    const y = valueAt(scene.y, t);
    // Everything the picture depends on, apart from the scene itself: what is
    // on screen, where, and how far along whatever is still coming in is.
    const coming = style.mode === 'reveal' ? page.words.slice(0, state.active + 1).map((w) => t - w.start) : [state.sincePage];
    const key = [state.page, state.active, step(y), ...coming.map(settle)].join(' ');
    if (scene !== this.scene || key !== this.drawn) {
      this.scene = scene;
      this.drawn = key;
      this.version++;
      this.draw(page, state, style, y, t);
    }
    return { image: this.canvas, version: this.version };
  }

  private draw(page: CaptionPage, state: CaptionState, style: CaptionStyle, y: number, t: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, OUTPUT.width, OUTPUT.height);
    ctx.font = cssFont(style.font, style.size);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';

    const space = ctx.measureText(' ').width;
    const lines = pageLines(page).map((words) => {
      const widths = words.map((w) => ctx.measureText(w.text).width);
      return { words, widths, width: widths.reduce((a, b) => a + b, 0) + space * (words.length - 1) };
    });
    const lineHeight = style.size * LINE_HEIGHT;
    const middle = y * OUTPUT.height;
    // A page too wide for the output shrinks around its middle.
    const widest = Math.max(...lines.map((l) => l.width));
    const fit = Math.min(1, (OUTPUT.width - 2 * SIDE_MARGIN) / widest);
    const reveal = style.mode === 'reveal';
    const whole = entrance(style, settle(state.sincePage));

    ctx.save();
    ctx.translate(OUTPUT.width / 2, middle);
    ctx.scale(fit, fit);
    if (!reveal) {
      ctx.globalAlpha = whole.alpha;
      ctx.scale(whole.scale, whole.scale);
    }
    let index = 0;
    lines.forEach((line, row) => {
      const cy = (row - (lines.length - 1) / 2) * lineHeight;
      let x = -line.width / 2;
      line.words.forEach((word, i) => {
        const w = line.widths[i]!;
        const at = index++;
        const cx = x + w / 2;
        x += w + space;
        if (reveal && at > state.active) return;
        const active = at === state.active && style.highlight.kind !== 'none';
        const own = reveal ? entrance(style, settle(t - word.start)) : { scale: 1, alpha: 1 };
        const scale = own.scale * (active ? style.activeScale : 1);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        if (reveal) ctx.globalAlpha = own.alpha;
        if (active && style.highlight.kind === 'box') {
          const padX = style.size * 0.2;
          const padY = style.size * 0.06;
          const h = style.size * 1.05;
          ctx.fillStyle = style.highlight.box;
          ctx.beginPath();
          ctx.roundRect(-w / 2 - padX, -h / 2 - padY, w + 2 * padX, h + 2 * padY, style.size * 0.22);
          ctx.fill();
        }
        this.text(word.text, style, active ? style.highlight.color : style.color);
        ctx.restore();
      });
    });
    ctx.restore();
  }

  /** One word at the origin: its shadow and outline first, then the letters. */
  private text(text: string, style: CaptionStyle, color: string): void {
    const ctx = this.ctx;
    const { shadow, outline } = style;
    if (shadow) {
      ctx.shadowColor = shadow.color;
      ctx.shadowBlur = shadow.blur;
      ctx.shadowOffsetY = shadow.offset;
    }
    if (outline.width > 0) {
      ctx.strokeStyle = outline.color;
      ctx.lineWidth = outline.width * 2;
      ctx.strokeText(text, 0, 0);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.shadowColor = 'transparent';
  }
}

/**
 * Everything the painter needs for a clip's captions, once their font has
 * loaded: null when the clip has none. A font that isn't on this computer
 * is swapped for the fallback here, so the preview and the export agree.
 */
export async function loadCaptionScene(layer: CaptionLayer | null, words: readonly Word[], range: { start: number; end: number }): Promise<CaptionScene | null> {
  if (!layer) return null;
  const font = await ensureFont(layer.style.font);
  const style = { ...layer.style, font };
  return { pages: captionPages(words, range, style), style, y: layer.y };
}
