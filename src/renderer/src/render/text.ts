/**
 * Paints text layers into pictures with Canvas2D, which the compositor then
 * places and animates like images. A picture depends only on the layer's
 * text and style (and how big it's ever drawn), not on the time, so it is
 * painted once and kept while those stay the same. The preview, the
 * handles over it and the export all get theirs from here, so they agree
 * on every pixel and on the picture's size.
 */
import i18n from 'i18next';
import { useEffect, useMemo, useState } from 'react';
import { cssFont, type FontRef } from '../../../shared/fonts.ts';
import type { Size } from '../../../shared/framing.ts';
import type { Clip, TextLayer } from '../../../shared/project.ts';
import { TEXT_LINE_HEIGHT, textLines, type TextStyle } from '../../../shared/text-style.ts';
import { ensureFont } from '../fonts/registry.ts';
import { useSettings } from '../settings.ts';
import { notify } from '../ui/prompts.ts';

/** A painted text layer: `size` is in output pixels at the layer's size 1; the canvas may hold more pixels than that. */
export interface TextImage {
  image: HTMLCanvasElement;
  size: Size;
}

/** Pictures are painted this much larger than the biggest the layer is drawn, for pops and pulses that overshoot. */
const OVERSHOOT = 1.3;
/** Most pixels per output pixel, and the longest side of a picture. */
const MAX_RATIO = 4;
const MAX_SIDE = 4096;
/**
 * Most canvas pixels kept painted, across layers (about 200 MB). Each
 * layer keeps only its latest picture; layers not drawn lately go first
 * when the pictures add up to more than this.
 */
const MAX_KEPT_PIXELS = 48_000_000;

/** The latest picture of each layer, by layer id, least recently used first, with what it was painted from. */
const painted = new Map<string, { key: string; image: TextImage }>();

const pixelsOf = (image: TextImage) => image.image.width * image.image.height;

/** Band around a line: how far past the letters it reaches, across and up and down, and its corners. */
const bandPad = (size: number) => ({ x: size * 0.28, y: size * 0.1, radius: size * 0.2 });

/** How many canvas pixels per output pixel the layer needs: enough for its biggest keyframe, in quarter steps. */
export function textRatio(layer: Pick<TextLayer, 'transform'>): number {
  const biggest = Math.max(...layer.transform.map((k) => k.value.scale));
  return Math.min(MAX_RATIO, Math.max(1, Math.ceil(biggest * OVERSHOOT * 4) / 4));
}

/**
 * Paints `text` in `style`, whose font has already loaded, `ratio` canvas
 * pixels per output pixel. Null when there's nothing to draw.
 */
export function paintText(text: string, style: TextStyle, ratio: number): TextImage | null {
  const lines = textLines(text, style.uppercase);
  if (!lines.some((runs) => runs.some((r) => r.text.trim()))) return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const { size } = style;
  ctx.font = cssFont(style.font, size);
  const measured = lines.map((runs) => {
    const widths = runs.map((r) => ctx.measureText(r.text).width);
    return { runs, widths, width: widths.reduce((a, b) => a + b, 0) };
  });
  const lineHeight = size * TEXT_LINE_HEIGHT;
  const band = bandPad(size);
  const shadow = style.shadow ? style.shadow.blur + style.shadow.offset : 0;
  // Room around the letters for the outline, the shadow and the band, the same on every side so the text stays centred.
  const margin = Math.ceil((style.band ? band.x : 0) + style.outline.width + shadow + 2);
  const blockWidth = Math.max(...measured.map((l) => l.width));
  const width = blockWidth + 2 * margin;
  const height = lines.length * lineHeight + 2 * margin;
  const r = Math.min(ratio, MAX_SIDE / Math.max(width, height));
  canvas.width = Math.ceil(width * r);
  canvas.height = Math.ceil(height * r);

  // Setting the size cleared the context's state.
  ctx.scale(r, r);
  ctx.font = cssFont(style.font, size);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  const placed = measured.map((line, i) => {
    const free = blockWidth - line.width;
    const left = margin + (style.align === 'left' ? 0 : style.align === 'right' ? free : free / 2);
    return { ...line, left, cy: margin + lineHeight * (i + 0.5) };
  });

  if (style.band) {
    ctx.fillStyle = style.band.color;
    for (const line of placed) {
      if (line.width === 0) continue;
      const h = size * 1.05 + 2 * band.y;
      ctx.beginPath();
      ctx.roundRect(line.left - band.x, line.cy - h / 2, line.width + 2 * band.x, h, band.radius);
      ctx.fill();
    }
  }

  /** Every run once, with `paint` drawing it at its place. */
  const eachRun = (paint: (text: string, x: number, y: number, accent: boolean) => void) => {
    for (const line of placed) {
      let x = line.left;
      line.runs.forEach((run, i) => {
        paint(run.text, x, line.cy, run.accent);
        x += line.widths[i]!;
      });
    }
  };
  // Outlines first for all the text, then the letters, so one word's outline never covers the next one's letters.
  const setShadow = () => {
    if (!style.shadow) return;
    ctx.shadowColor = style.shadow.color;
    ctx.shadowBlur = style.shadow.blur * r;
    ctx.shadowOffsetY = style.shadow.offset * r;
  };
  setShadow();
  if (style.outline.width > 0) {
    ctx.strokeStyle = style.outline.color;
    ctx.lineWidth = style.outline.width * 2;
    eachRun((t, x, y) => ctx.strokeText(t, x, y));
    ctx.shadowColor = 'transparent';
  }
  eachRun((t, x, y, accent) => {
    ctx.fillStyle = accent ? style.accent : style.color;
    ctx.fillText(t, x, y);
  });
  return { image: canvas, size: { width: canvas.width / r, height: canvas.height / r } };
}

/** What a text layer's picture depends on. */
interface TextSpec {
  id: string;
  text: string;
  style: TextStyle;
  ratio: number;
}

const specOf = (layer: TextLayer): TextSpec => ({ id: layer.id, text: layer.text, style: layer.style, ratio: textRatio(layer) });

/** The picture for `spec`, painted once its font has loaded (a font that isn't here is swapped for the fallback), or null for empty text. */
async function textImage(spec: TextSpec): Promise<TextImage | null> {
  const font: FontRef = await ensureFont(spec.style.font);
  const style = { ...spec.style, font };
  const key = JSON.stringify([spec.text, style, spec.ratio]);
  const held = painted.get(spec.id);
  // Most recently used goes last, so the one not drawn the longest goes first.
  painted.delete(spec.id);
  if (held?.key === key) {
    painted.set(spec.id, held);
    return held.image;
  }
  const image = paintText(spec.text, style, spec.ratio);
  if (!image) return null;
  painted.set(spec.id, { key, image });
  let total = 0;
  for (const p of painted.values()) total += pixelsOf(p.image);
  for (const [id, p] of painted) {
    if (total <= MAX_KEPT_PIXELS || id === spec.id) break;
    painted.delete(id);
    total -= pixelsOf(p.image);
  }
  return image;
}

async function loadSpecs(specs: readonly TextSpec[]): Promise<Map<string, TextImage>> {
  const images = await Promise.all(specs.map(textImage));
  return new Map(specs.flatMap((s, i) => (images[i] ? [[s.id, images[i]] as const] : [])));
}

const textLayers = (clip: Pick<Clip, 'layers'>): TextLayer[] => clip.layers.filter((l): l is TextLayer => l.kind === 'text');

/** The pictures of the clip's text layers, by layer id; an empty one isn't there. */
export const loadTexts = (clip: Pick<Clip, 'layers'>): Promise<Map<string, TextImage>> => loadSpecs(textLayers(clip).map(specOf));

const NONE: ReadonlyMap<string, TextImage> = new Map();

/**
 * The pictures of the clip's text layers, kept up to date as they're
 * edited. While a new one is being painted the old one stays.
 */
export function useTextImages(clip: Pick<Clip, 'layers'>): ReadonlyMap<string, TextImage> {
  const [images, setImages] = useState(NONE);
  // Adding a font the text was missing changes how it's drawn.
  const fonts = useSettings((s) => s.fonts);
  // What the pictures depend on, as a value that changes only when they do (not when a layer moves a little).
  const json = useMemo(() => JSON.stringify(textLayers({ layers: clip.layers }).map(specOf)), [clip.layers]);
  useEffect(() => {
    let current = true;
    loadSpecs(JSON.parse(json) as TextSpec[]).then(
      (loaded) => current && setImages(loaded),
      // Not even the fallback font loads: the text can't be drawn, here or in the export.
      (e: unknown) => current && notify('error', i18n.t('errors.unexpected', { detail: e instanceof Error ? e.message : String(e) })),
    );
    return () => {
      current = false;
    };
  }, [json, fonts]);
  return images;
}
