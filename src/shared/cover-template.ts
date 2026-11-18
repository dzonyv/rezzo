/**
 * Cover templates: the look of a cover kept apart from any clip, the way
 * caption styles are. A template has the cover's titles (their style and
 * place), the cutout and the effects, bottom first. It has no images, and
 * no moment or framing: those belong to the clip. The app comes with a few
 * (BUILT_IN_TEMPLATES); the user's own are saved in the settings.
 */
import { z } from 'zod';
import { NO_MOTION } from './cover.ts';
import { cutoutStyleSchema, DEFAULT_CUTOUT_STYLE } from './cutout.ts';
import { colorValid, defaultColor, defaultParams, EFFECT_NAMES, paramsValid, STILL_EFFECTS, type EffectName } from './effects.ts';
import { valueAt } from './framing.ts';
import { transformSchema, type Transform } from './motion.ts';
import type { Cover, CoverLayer } from './project.ts';
import { DEFAULT_TEXT_STYLE, MAX_TEXT_CHARS, textStyleSchema, type TextStyle } from './text-style.ts';

/** Most layers a template has. */
export const MAX_TEMPLATE_LAYERS = 20;

const templateLayerSchema = z.discriminatedUnion('kind', [
  /** A title; `text` is what it says when the cover has no title of its own to keep, "" for the placeholder. */
  z.object({ kind: z.literal('text'), text: z.string().max(MAX_TEXT_CHARS), style: textStyleSchema, place: transformSchema }),
  z.object({ kind: z.literal('cutout'), style: cutoutStyleSchema }),
  z
    .object({
      kind: z.literal('effect'),
      effect: z.enum(EFFECT_NAMES),
      intensity: z.number().min(0).max(1),
      params: z.record(z.string(), z.number().finite()),
      color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    })
    .refine((l) => STILL_EFFECTS.includes(l.effect) && paramsValid(l.effect, l.params) && colorValid(l), 'an effect that suits a cover, with its own settings'),
]);
export type TemplateLayer = z.infer<typeof templateLayerSchema>;

export const coverTemplateSchema = z.object({ layers: z.array(templateLayerSchema).max(MAX_TEMPLATE_LAYERS) });
export type CoverTemplate = z.infer<typeof coverTemplateSchema>;

export const savedTemplateSchema = z.object({ name: z.string().min(1).max(60), template: coverTemplateSchema });
export type SavedTemplate = z.infer<typeof savedTemplateSchema>;

/** The template a cover makes: its layers but the images, each as it is at the cover's moment. */
export function templateOf(cover: Pick<Cover, 'time' | 'layers'>): CoverTemplate {
  const layers: TemplateLayer[] = [];
  for (const l of cover.layers) {
    if (l.kind === 'text') layers.push({ kind: 'text', text: l.text, style: structuredClone(l.style), place: { ...valueAt(l.transform, cover.time) } });
    else if (l.kind === 'cutout') layers.push({ kind: 'cutout', style: structuredClone(l.style) });
    else if (l.kind === 'effect') {
      const effect: TemplateLayer = { kind: 'effect', effect: l.effect, intensity: valueAt(l.intensity, cover.time), params: { ...l.params } };
      layers.push(l.color === undefined ? effect : { ...effect, color: l.color });
    }
  }
  return { layers: layers.slice(-MAX_TEMPLATE_LAYERS) };
}

/** A new layer's id; tests pass their own. */
type NewId = () => string;

/**
 * The cover's layers with `template` put on: the template's layers, in
 * its order, with the cover's titles keeping their words. The first title
 * of the template gets the words of the cover's first title, and so on;
 * a template title with nobody's words says its own text, or `placeholder`.
 * What the template has no place for stays over it as it was: images, and
 * titles past the template's.
 */
export function applyTemplate(
  cover: Pick<Cover, 'time' | 'layers'>,
  range: { start: number; end: number },
  template: CoverTemplate,
  placeholder: string,
  newId: NewId = () => crypto.randomUUID(),
): CoverLayer[] {
  const titles = cover.layers.filter((l) => l.kind === 'text');
  const { start, end } = range;
  const at = cover.time;
  let used = 0;
  const made = template.layers.map((l): CoverLayer => {
    switch (l.kind) {
      case 'text': {
        const words = titles[used++]?.text ?? (l.text || placeholder);
        return {
          id: newId(),
          kind: 'text',
          text: words.slice(0, MAX_TEXT_CHARS),
          style: structuredClone(l.style),
          start,
          end,
          transform: [{ t: at, value: { ...l.place }, ease: 'cut' }],
          motion: structuredClone(NO_MOTION),
        };
      }
      case 'cutout':
        return { id: newId(), kind: 'cutout', start, end, style: structuredClone(l.style) };
      case 'effect': {
        const effect: CoverLayer = { id: newId(), kind: 'effect', effect: l.effect, start, end, intensity: [{ t: at, value: l.intensity, ease: 'cut' }], params: { ...l.params } };
        return l.color === undefined ? effect : { ...effect, color: l.color };
      }
    }
  });
  const kept = cover.layers.filter((l) => l.kind === 'image' || (l.kind === 'text' && titles.indexOf(l) >= used));
  return [...made, ...kept];
}

const title = (place: Partial<Transform>, style: Partial<TextStyle> = {}): TemplateLayer => ({
  kind: 'text',
  text: '',
  style: { ...DEFAULT_TEXT_STYLE, ...style },
  place: { x: 0.5, y: 0.4, scale: 1, rotation: 0, opacity: 1, ...place },
});

const effect = (name: EffectName, intensity: number, params: Record<string, number> = {}, color?: string): TemplateLayer => {
  const base: TemplateLayer = { kind: 'effect', effect: name, intensity, params: { ...defaultParams(name), ...params } };
  const c = color ?? defaultColor(name);
  return c === undefined ? base : { ...base, color: c };
};

/** The templates that come with the app; ids are translation keys under cover.templates. */
export const BUILT_IN_TEMPLATES: readonly { id: string; template: CoverTemplate }[] = [
  // A white title near the top, over the picture as it is.
  { id: 'classic', template: { layers: [title({ y: 0.2 })] } },
  // A big yellow title the people stand in front of, with a white outline round them.
  {
    id: 'behind',
    template: {
      layers: [title({ y: 0.3, scale: 1.5 }, { color: '#ffd400', accent: '#ffffff', outline: { color: '#000000', width: 0 } }), { kind: 'cutout', style: structuredClone(DEFAULT_CUTOUT_STYLE) }],
    },
  },
  // The bottom fades to black under a title down there.
  {
    id: 'fade',
    template: { layers: [effect('gradient', 0.9, { reach: 0.55 }), title({ y: 0.74 }, { outline: { color: '#000000', width: 0 }, shadow: { color: '#000000', blur: 18, offset: 4 } })] },
  },
  // The picture darker at the edges and the people glowing, the title on a band.
  {
    id: 'glow',
    template: {
      layers: [
        effect('vignette', 0.8, { size: 0.6 }),
        title({ y: 0.22, scale: 0.9 }, { color: '#111111', accent: '#e0004d', outline: { color: '#000000', width: 0 }, band: { color: '#ffd400' } }),
        { kind: 'cutout', style: { outline: { color: '#ffffff', width: 0 }, glow: { color: '#ffd400', size: 60 } } },
      ],
    },
  },
];
