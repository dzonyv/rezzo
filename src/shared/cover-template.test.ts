import { describe, expect, it } from 'vitest';
import { applyTemplate, BUILT_IN_TEMPLATES, coverTemplateSchema, templateOf, type CoverTemplate } from './cover-template.ts';
import { NO_MOTION } from './cover.ts';
import { DEFAULT_CUTOUT_STYLE } from './cutout.ts';
import { defaultParams } from './effects.ts';
import { coverLayerSchema, type CoverLayer } from './project.ts';
import { DEFAULT_TEXT_STYLE } from './text-style.ts';

const RANGE = { start: 10, end: 20 };
const place = (y: number) => ({ x: 0.5, y, scale: 1, rotation: 0, opacity: 1 });
let n = 0;
const ids = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

const text = (words: string, y = 0.4): CoverLayer => ({
  id: crypto.randomUUID(), kind: 'text', text: words, style: DEFAULT_TEXT_STYLE, start: 10, end: 20,
  transform: [{ t: 12, value: place(y), ease: 'cut' }], motion: NO_MOTION,
});
const image: CoverLayer = {
  id: crypto.randomUUID(), kind: 'image', assetId: crypto.randomUUID(), start: 10, end: 20,
  transform: [{ t: 12, value: place(0.9), ease: 'cut' }], motion: NO_MOTION, key: null,
};

describe('cover templates', () => {
  it('come with the app as valid templates that make valid cover layers', () => {
    for (const { template } of BUILT_IN_TEMPLATES) {
      expect(coverTemplateSchema.parse(template)).toEqual(template);
      for (const layer of applyTemplate({ time: 12, layers: [] }, RANGE, template, 'Naslov')) expect(() => coverLayerSchema.parse(layer)).not.toThrow();
    }
  });

  it("keep a cover's titles, cutout and effects as they are at its moment, but not its images", () => {
    const blur: CoverLayer = { id: crypto.randomUUID(), kind: 'effect', effect: 'blur', start: 10, end: 20, intensity: [{ t: 11, value: 0.4, ease: 'cut' }], params: defaultParams('blur') };
    const people: CoverLayer = { id: crypto.randomUUID(), kind: 'cutout', start: 10, end: 20, style: DEFAULT_CUTOUT_STYLE };
    const template = templateOf({ time: 12, layers: [blur, text('Ona *laže*', 0.3), image, people] });
    expect(template.layers.map((l) => l.kind)).toEqual(['effect', 'text', 'cutout']);
    expect(template.layers[0]).toEqual({ kind: 'effect', effect: 'blur', intensity: 0.4, params: { amount: 0.5 } });
    // The look and the place, not the words: they're about this clip.
    expect(template.layers[1]).toMatchObject({ text: '', place: place(0.3) });
    expect(coverTemplateSchema.parse(template)).toEqual(template);
  });

  it("put the template's layers on in its order, the cover's titles keeping their words", () => {
    const template: CoverTemplate = templateOf({ time: 0, layers: [text('Prvi', 0.2), text('Drugi', 0.8)] });
    const layers = applyTemplate({ time: 12, layers: [text('Moj naslov', 0.5)] }, RANGE, template, 'Tvoj naslov', ids);
    expect(layers.map((l) => (l.kind === 'text' ? l.text : l.kind))).toEqual(['Moj naslov', 'Tvoj naslov']);
    expect(layers[0]).toMatchObject({ start: 10, end: 20, transform: [{ t: 12, value: place(0.2) }] });
  });

  it('give a title with nobody\'s words the placeholder when the template has no text of its own', () => {
    const layers = applyTemplate({ time: 12, layers: [] }, RANGE, BUILT_IN_TEMPLATES.find((b) => b.id === 'classic')!.template, 'Tvoj *naslov*');
    expect(layers).toMatchObject([{ kind: 'text', text: 'Tvoj *naslov*' }]);
  });

  it("leave a background image under it, and other images and titles past the template's over it", () => {
    const extra = text('Još jedan', 0.6);
    const logo = { ...image, id: crypto.randomUUID() };
    const template = BUILT_IN_TEMPLATES.find((b) => b.id === 'behind')!.template;
    const layers = applyTemplate({ time: 12, layers: [image, text('Prvi'), logo, extra] }, RANGE, template, 'x');
    expect(layers.map((l) => l.kind)).toEqual(['image', 'text', 'cutout', 'image', 'text']);
    expect(layers[0]).toBe(image);
    expect(layers[1]).toMatchObject({ text: 'Prvi' });
    expect(layers[3]).toBe(logo);
    expect(layers[4]).toBe(extra);
  });

  it('rejects a second cutout, or the same effect twice', () => {
    const blur = { kind: 'effect', effect: 'blur', intensity: 1, params: defaultParams('blur') };
    expect(() => coverTemplateSchema.parse({ layers: [blur, blur] })).toThrow();
    expect(() => coverTemplateSchema.parse({ layers: [{ kind: 'cutout', style: DEFAULT_CUTOUT_STYLE }, { kind: 'cutout', style: DEFAULT_CUTOUT_STYLE }] })).toThrow();
  });

  it('rejects an effect a cover cannot have', () => {
    expect(() => coverTemplateSchema.parse({ layers: [{ kind: 'effect', effect: 'zoomPunch', intensity: 1, params: defaultParams('zoomPunch') }] })).toThrow();
    expect(() => coverTemplateSchema.parse({ layers: [{ kind: 'effect', effect: 'gradient', intensity: 1, params: defaultParams('gradient') }] })).toThrow();
  });
});
