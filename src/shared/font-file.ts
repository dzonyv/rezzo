/**
 * Reads what Rezzo needs from a TrueType or OpenType font file: its family
 * name, weight and which characters it has. Small on purpose: the tables
 * are read just far enough for that, and anything unexpected throws.
 */

export interface FontInfo {
  family: string;
  /** usWeightClass from the OS/2 table: 400 regular, 700 bold. */
  weight: number;
  /** Has an fvar table, i.e. one file covers a range of weights. */
  variable: boolean;
  /** The version string from the name table, e.g. "Version 4.004". */
  version: string;
  /** Whether the font has a glyph for this code point. */
  has(codePoint: number): boolean;
}

/** Letters a caption font has to have for BCS text. */
export const BCS_LETTERS = 'čćžšđČĆŽŠĐ';

export class FontFileError extends Error {}

interface Table {
  offset: number;
  length: number;
}

function tables(view: DataView): Map<string, Table> {
  const tag = view.getUint32(0);
  // 0x00010000 and "true": TrueType outlines; "OTTO": CFF outlines.
  if (tag !== 0x00010000 && tag !== 0x74727565 && tag !== 0x4f54544f) throw new FontFileError('not a TrueType or OpenType font');
  const count = view.getUint16(4);
  const out = new Map<string, Table>();
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const name = String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
    const offset = view.getUint32(at + 8);
    const length = view.getUint32(at + 12);
    if (offset + length > view.byteLength) throw new FontFileError(`table ${name} runs past the end of the file`);
    out.set(name, { offset, length });
  }
  return out;
}

/** Code point ranges [first, last] that map to a real glyph. */
function cmapRanges(view: DataView, cmap: Table): [number, number][] {
  const count = view.getUint16(cmap.offset + 2);
  // Prefer the full Unicode table (format 12) over the BMP one (format 4).
  let best: { offset: number; format: number } | undefined;
  for (let i = 0; i < count; i++) {
    const at = cmap.offset + 4 + i * 8;
    const platform = view.getUint16(at);
    const encoding = view.getUint16(at + 2);
    const offset = cmap.offset + view.getUint32(at + 4);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    const format = view.getUint16(offset);
    if ((format === 12 && best?.format !== 12) || (format === 4 && !best)) best = { offset, format };
  }
  if (!best) throw new FontFileError('no Unicode character map');
  const ranges: [number, number][] = [];
  const o = best.offset;
  if (best.format === 12) {
    const groups = view.getUint32(o + 12);
    for (let i = 0; i < groups; i++) {
      const g = o + 16 + i * 12;
      ranges.push([view.getUint32(g), view.getUint32(g + 4)]);
    }
    return ranges;
  }
  const segments = view.getUint16(o + 6) / 2;
  const ends = o + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const rangeOffsets = deltas + segments * 2;
  for (let i = 0; i < segments; i++) {
    const end = view.getUint16(ends + i * 2);
    const start = view.getUint16(starts + i * 2);
    const delta = view.getUint16(deltas + i * 2);
    const rangeOffset = view.getUint16(rangeOffsets + i * 2);
    if (start === 0xffff) continue;
    // Each code point is checked for glyph 0 (missing), which a segment may hold.
    let runStart = -1;
    for (let c = start; c <= end; c++) {
      let glyph: number;
      if (rangeOffset === 0) {
        glyph = (c + delta) & 0xffff;
      } else {
        const at = rangeOffsets + i * 2 + rangeOffset + (c - start) * 2;
        glyph = at + 2 <= view.byteLength ? view.getUint16(at) : 0;
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0 && runStart < 0) runStart = c;
      if (glyph === 0 && runStart >= 0) {
        ranges.push([runStart, c - 1]);
        runStart = -1;
      }
    }
    if (runStart >= 0) ranges.push([runStart, end]);
  }
  return ranges;
}

/** Name `id` from the name table, preferring Windows English, then any Unicode entry. */
function nameOf(view: DataView, name: Table, id: number): string | undefined {
  const count = view.getUint16(name.offset + 2);
  const strings = name.offset + view.getUint16(name.offset + 4);
  let fallback: string | undefined;
  for (let i = 0; i < count; i++) {
    const at = name.offset + 6 + i * 12;
    const platform = view.getUint16(at);
    const language = view.getUint16(at + 4);
    if (view.getUint16(at + 6) !== id) continue;
    const length = view.getUint16(at + 8);
    const offset = strings + view.getUint16(at + 10);
    let text: string;
    if (platform === 0 || platform === 3) {
      text = '';
      for (let j = 0; j + 1 < length; j += 2) text += String.fromCharCode(view.getUint16(offset + j));
    } else if (platform === 1) {
      text = '';
      for (let j = 0; j < length; j++) text += String.fromCharCode(view.getUint8(offset + j));
    } else {
      continue;
    }
    if (platform === 3 && language === 0x0409) return text;
    fallback ??= text;
  }
  return fallback;
}

export function readFont(bytes: Uint8Array): FontInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    const t = tables(view);
    const cmap = t.get('cmap');
    const name = t.get('name');
    if (!cmap || !name) throw new FontFileError('missing cmap or name table');
    const ranges = cmapRanges(view, cmap).sort((a, b) => a[0] - b[0]);
    // Typographic family (16) groups all weights; older fonts only have 1.
    const family = (nameOf(view, name, 16) ?? nameOf(view, name, 1))?.trim();
    if (!family) throw new FontFileError('no family name');
    const os2 = t.get('OS/2');
    return {
      family,
      weight: os2 ? view.getUint16(os2.offset + 4) : 400,
      variable: t.has('fvar'),
      version: nameOf(view, name, 5)?.trim() ?? '',
      has(codePoint) {
        let lo = 0;
        let hi = ranges.length - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const [first, last] = ranges[mid]!;
          if (codePoint < first) hi = mid - 1;
          else if (codePoint > last) lo = mid + 1;
          else return true;
        }
        return false;
      },
    };
  } catch (e) {
    if (e instanceof FontFileError) throw e;
    // Reading past the end of a truncated file.
    throw new FontFileError(e instanceof Error ? e.message : String(e));
  }
}

/** The characters of `text` the font has no glyph for, each once. */
export function missingLetters(font: Pick<FontInfo, 'has'>, text: string): string[] {
  return [...new Set(text)].filter((c) => !font.has(c.codePointAt(0)!));
}
