/**
 * The fonts that ship with Rezzo (in src/renderer/src/fonts, each folder
 * with its OFL.txt) and the ones the user adds. A caption style names a
 * font by family and weight only, so a project carries no font files.
 */
import { z } from 'zod';

export interface BundledFont {
  family: string;
  /** Folder under src/renderer/src/fonts. */
  folder: string;
  /** Weight -> file; a variable font has one file for its whole range. */
  files: { weight: number | [number, number]; file: string }[];
}

export const BUNDLED_FONTS: readonly BundledFont[] = [
  {
    family: 'Poppins',
    folder: 'poppins',
    files: [
      { weight: 500, file: 'Poppins-Medium.ttf' },
      { weight: 600, file: 'Poppins-SemiBold.ttf' },
      { weight: 700, file: 'Poppins-Bold.ttf' },
      { weight: 800, file: 'Poppins-ExtraBold.ttf' },
      { weight: 900, file: 'Poppins-Black.ttf' },
    ],
  },
  { family: 'Montserrat', folder: 'montserrat', files: [{ weight: [100, 900], file: 'Montserrat[wght].ttf' }] },
  { family: 'Anton', folder: 'anton', files: [{ weight: 400, file: 'Anton-Regular.ttf' }] },
];

/** The weights offered for a variable font. */
const VARIABLE_STEPS = [400, 500, 600, 700, 800, 900];

export const fontRefSchema = z.object({
  family: z.string().min(1).max(100),
  weight: z.number().int().min(100).max(900),
});
export type FontRef = z.infer<typeof fontRefSchema>;

/** What every caption falls back to: the default style's font. */
export const FALLBACK_FONT: FontRef = { family: 'Poppins', weight: 700 };

/** A font the user added; the file sits in the app's fonts folder under this name. */
export const customFontSchema = fontRefSchema.extend({
  file: z.string().regex(/^[0-9a-f]{64}\.(ttf|otf)$/),
});
export type CustomFont = z.infer<typeof customFontSchema>;

/** Every family and its weights, bundled first. */
export function fontChoices(custom: readonly CustomFont[]): { family: string; weights: number[] }[] {
  const out = BUNDLED_FONTS.map((f) => ({
    family: f.family,
    weights: f.files.flatMap(({ weight }) => (Array.isArray(weight) ? VARIABLE_STEPS.filter((w) => w >= weight[0] && w <= weight[1]) : [weight])),
  }));
  for (const c of custom) {
    const entry = out.find((f) => f.family === c.family);
    if (!entry) out.push({ family: c.family, weights: [c.weight] });
    else if (!entry.weights.includes(c.weight)) entry.weights.push(c.weight);
  }
  for (const f of out) f.weights.sort((a, b) => a - b);
  return out;
}

/** Whether the font is on this computer: bundled, or added by the user. */
export function hasFont(font: FontRef, custom: readonly CustomFont[]): boolean {
  const bundled = BUNDLED_FONTS.find((f) => f.family === font.family);
  if (bundled?.files.some(({ weight }) => (Array.isArray(weight) ? font.weight >= weight[0] && font.weight <= weight[1] : weight === font.weight))) return true;
  return custom.some((c) => c.family === font.family && c.weight === font.weight);
}

/** The CSS font shorthand for drawing text in `font`, falling back to Poppins. */
export const cssFont = (font: FontRef, px: number): string => `${font.weight} ${px}px "${font.family}", "${FALLBACK_FONT.family}"`;
