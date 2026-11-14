/**
 * How a text layer looks: a title you type yourself, unlike captions,
 * which come from the transcript. Words between asterisks ("ON JE *LAGAO*")
 * are drawn in the accent colour.
 *
 * Sizes are output pixels (the output is 1080 wide) at the layer's size 1.
 */
import { z } from 'zod';
import { fontRefSchema } from './fonts.ts';

const color = z.string().regex(/^#[0-9a-f]{6}$/i);

export const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export const MIN_TEXT_SIZE = 24;
export const MAX_TEXT_SIZE = 240;
export const MAX_TEXT_OUTLINE = 24;
export const MAX_TEXT_CHARS = 400;
/** Line spacing, as a share of the font size. */
export const TEXT_LINE_HEIGHT = 1.15;

export const textStyleSchema = z.object({
  font: fontRefSchema,
  size: z.number().min(MIN_TEXT_SIZE).max(MAX_TEXT_SIZE),
  uppercase: z.boolean(),
  align: z.enum(TEXT_ALIGNS),
  color,
  /** The colour of words between asterisks. */
  accent: color,
  outline: z.object({ color, width: z.number().min(0).max(MAX_TEXT_OUTLINE) }),
  /** Null: no shadow. */
  shadow: z.object({ color, blur: z.number().min(0).max(40), offset: z.number().min(0).max(30) }).nullable(),
  /** A rounded band behind each line, or null for none. */
  band: z.object({ color }).nullable(),
});
export type TextStyle = z.infer<typeof textStyleSchema>;

/** The default: Anton in capitals, white with a black outline, marked words yellow. */
export const DEFAULT_TEXT_STYLE: TextStyle = {
  font: { family: 'Anton', weight: 400 },
  size: 120,
  uppercase: true,
  align: 'center',
  color: '#ffffff',
  accent: '#ffd400',
  outline: { color: '#000000', width: 10 },
  shadow: null,
  band: null,
};

/** A stretch of one line, drawn in the accent colour or not. */
export interface TextRun {
  text: string;
  accent: boolean;
}

/**
 * The text as lines of runs. An asterisk switches the accent on or off,
 * and the accent carries over to the next line, so a marked stretch can
 * span lines; "**" is a literal asterisk. Spaces at either end of a line
 * are left out, so they don't push a line off centre. Empty runs are left
 * out; an empty line stays, as an empty list.
 */
export function textLines(text: string, uppercase: boolean): TextRun[][] {
  const shown = uppercase ? text.toLocaleUpperCase('sr-Latn') : text;
  let accent = false;
  return shown.split(/\r?\n/).map((line) => {
    const runs: TextRun[] = [];
    let part = '';
    const flush = () => {
      if (part) runs.push({ text: part, accent });
      part = '';
    };
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (c !== '*') part += c;
      else if (line[i + 1] === '*') {
        part += '*';
        i++;
      } else {
        flush();
        accent = !accent;
      }
    }
    flush();
    return trimLine(runs);
  });
}

/** The runs without the spaces at the line's start and end. */
function trimLine(runs: TextRun[]): TextRun[] {
  const out = runs.map((r) => ({ ...r }));
  while (out[0]) {
    out[0].text = out[0].text.trimStart();
    if (out[0].text) break;
    out.shift();
  }
  while (out.at(-1)) {
    const last = out.at(-1)!;
    last.text = last.text.trimEnd();
    if (last.text) break;
    out.pop();
  }
  return out;
}

/** The text without its asterisks, on one line: what a text layer is called on the timeline. */
export function textName(text: string): string {
  return textLines(text, false)
    .map((runs) => runs.map((r) => r.text).join(''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
