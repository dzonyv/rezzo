/**
 * How captions look. A clip keeps a full copy of its style, so a project
 * looks the same on a computer without the user's saved styles.
 *
 * Sizes are output pixels (the output is 1080 wide).
 */
import { z } from 'zod';
import { FALLBACK_FONT, fontRefSchema } from './fonts.ts';

const color = z.string().regex(/^#[0-9a-f]{6}$/i);

/** color: the spoken word changes colour; box: it gets a box behind it; none: nothing marks it. */
export const HIGHLIGHTS = ['color', 'box', 'none'] as const;
/** page: the whole page of words shows at once; reveal: words appear as they're spoken. */
export const CAPTION_MODES = ['page', 'reveal'] as const;
/** How a page (or, in reveal, each word) comes in. */
export const ENTRANCES = ['none', 'pop', 'fade'] as const;

export const MIN_CAPTION_SIZE = 32;
export const MAX_CAPTION_SIZE = 160;
export const MIN_LINE_CHARS = 6;
export const MAX_LINE_CHARS = 40;
export const MAX_ACTIVE_SCALE = 1.4;

export const captionStyleSchema = z.object({
  font: fontRefSchema,
  size: z.number().min(MIN_CAPTION_SIZE).max(MAX_CAPTION_SIZE),
  uppercase: z.boolean(),
  color,
  outline: z.object({ color, width: z.number().min(0).max(24) }),
  /** Null: no shadow. */
  shadow: z.object({ color, blur: z.number().min(0).max(40), offset: z.number().min(0).max(30) }).nullable(),
  highlight: z.object({
    kind: z.enum(HIGHLIGHTS),
    /** The spoken word's text colour. */
    color,
    /** The box behind it, for kind "box". */
    box: color,
  }),
  mode: z.enum(CAPTION_MODES),
  entrance: z.enum(ENTRANCES),
  /** How much bigger the spoken word is drawn; 1 for not at all. */
  activeScale: z.number().min(1).max(MAX_ACTIVE_SCALE),
  lines: z.union([z.literal(1), z.literal(2)]),
  /** Most characters on one line; a longer page breaks onto the next line or page. */
  maxChars: z.number().int().min(MIN_LINE_CHARS).max(MAX_LINE_CHARS),
});
export type CaptionStyle = z.infer<typeof captionStyleSchema>;

export const savedStyleSchema = z.object({ name: z.string().min(1).max(60), style: captionStyleSchema });
export type SavedStyle = z.infer<typeof savedStyleSchema>;

/** The default: Poppins Bold in capitals, white with a black outline, the spoken word yellow. */
export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  font: FALLBACK_FONT,
  size: 76,
  uppercase: true,
  color: '#ffffff',
  outline: { color: '#000000', width: 8 },
  shadow: null,
  highlight: { kind: 'color', color: '#ffd400', box: '#ffd400' },
  mode: 'page',
  entrance: 'pop',
  activeScale: 1.08,
  lines: 2,
  maxChars: 18,
};

/** The styles that come with the app; ids are translation keys under captions.styles. */
export const BUILT_IN_STYLES: readonly { id: string; style: CaptionStyle }[] = [
  { id: 'classic', style: DEFAULT_CAPTION_STYLE },
  {
    id: 'box',
    style: {
      ...DEFAULT_CAPTION_STYLE,
      font: { family: 'Poppins', weight: 800 },
      outline: { color: '#000000', width: 0 },
      shadow: { color: '#000000', blur: 12, offset: 4 },
      highlight: { kind: 'box', color: '#ffffff', box: '#7c3aed' },
      activeScale: 1,
    },
  },
  {
    id: 'reveal',
    style: {
      ...DEFAULT_CAPTION_STYLE,
      font: { family: 'Poppins', weight: 900 },
      mode: 'reveal',
      highlight: { kind: 'color', color: '#22e06b', box: '#22e06b' },
      activeScale: 1.15,
      lines: 1,
      maxChars: 14,
    },
  },
  {
    id: 'calm',
    style: {
      ...DEFAULT_CAPTION_STYLE,
      font: { family: 'Montserrat', weight: 600 },
      size: 60,
      uppercase: false,
      outline: { color: '#000000', width: 0 },
      shadow: { color: '#000000', blur: 18, offset: 3 },
      highlight: { kind: 'none', color: '#ffffff', box: '#ffffff' },
      entrance: 'fade',
      activeScale: 1,
      maxChars: 26,
    },
  },
  {
    id: 'headline',
    style: {
      ...DEFAULT_CAPTION_STYLE,
      font: { family: 'Anton', weight: 400 },
      size: 110,
      outline: { color: '#000000', width: 10 },
      highlight: { kind: 'color', color: '#ff3b5c', box: '#ff3b5c' },
      activeScale: 1.05,
      lines: 2,
      maxChars: 14,
    },
  },
];
