/**
 * Captions laid out over time: which of the transcript's words a clip
 * shows, how they're grouped into pages and lines, and what is on screen
 * at a given moment. Pure functions, shared by the preview and the export.
 */
import type { CaptionStyle } from './caption-style.ts';
import { valueAt } from './framing.ts';
import type { Animated, CaptionLayer, Layout as PictureLayout, Word } from './project.ts';

/** A pause longer than this starts a new page. */
export const PAGE_GAP_SECONDS = 0.7;
/** A page stays up at most this long after its last word ends, when nothing follows right away. */
export const PAGE_HOLD_SECONDS = 0.5;
/** Where new captions sit: a little below the middle, clear of the app buttons at the bottom of a phone. */
export const DEFAULT_CAPTION_Y = 0.7;
/** Where captions nobody moved sit in Split: on the line between the halves, since 0.7 is the lower person's face. */
export const SPLIT_CAPTION_Y = 0.5;
/** Line height as a share of the font size. */
export const LINE_HEIGHT = 1.2;

export interface CaptionWord {
  /** As drawn: in capitals when the style says so. */
  text: string;
  /** When it counts as spoken; never before the word ahead of it. */
  start: number;
  end: number;
}

export interface CaptionPage {
  words: CaptionWord[];
  /** Index of the first word on each line. */
  lineStarts: number[];
  start: number;
  end: number;
}

export interface CaptionState {
  /** Index into the pages. */
  page: number;
  /** The word being spoken, an index into the page's words. */
  active: number;
  /** Seconds since the page came up. */
  sincePage: number;
}

type Layout = Pick<CaptionStyle, 'lines' | 'maxChars'>;

const endsSentence = (text: string) => /[.?!…]["”“»)]*$/.test(text);

/** Characters a line of these words takes, spaces between them included. */
const lineLength = (words: readonly CaptionWord[]) => words.reduce((n, w) => n + w.text.length, 0) + Math.max(0, words.length - 1);

/** Line starts of words filled into lines of at most maxChars, a word too long for any line getting one of its own. */
function greedyLines(words: readonly CaptionWord[], maxChars: number): number[] {
  const starts: number[] = [];
  let length = 0;
  words.forEach((w, i) => {
    if (i === 0 || length + 1 + w.text.length > maxChars) {
      starts.push(i);
      length = w.text.length;
    } else {
      length += 1 + w.text.length;
    }
  });
  return starts;
}

/**
 * Lines as even as they can be: a page that needs two lines breaks where
 * the longer line is shortest, rather than filling the first line up.
 */
function balancedLines(words: readonly CaptionWord[], style: Layout): number[] {
  const greedy = greedyLines(words, style.maxChars);
  if (greedy.length !== 2) return greedy;
  let best = greedy[1]!;
  let bestLength = Infinity;
  for (let k = 1; k < words.length; k++) {
    const a = lineLength(words.slice(0, k));
    const b = lineLength(words.slice(k));
    const longest = Math.max(a, b);
    if (longest > style.maxChars && k !== greedy[1]) continue;
    if (longest < bestLength) {
      best = k;
      bestLength = longest;
    }
  }
  return [0, best];
}

function page(words: CaptionWord[], style: Layout): CaptionPage {
  return { words, lineStarts: balancedLines(words, style), start: words[0]!.start, end: Math.max(...words.map((w) => w.end)) };
}

/** Whether a clip over `range` shows the word in its captions: its middle is inside the range. */
export function inCaptions(word: Pick<Word, 'start' | 'end'>, range: { start: number; end: number }): boolean {
  const middle = (word.start + word.end) / 2;
  return middle >= range.start && middle < range.end;
}

/**
 * The clip's captions, page by page (see inCaptions for which words). A
 * page ends at a sentence end, a pause, a word the user marked as starting
 * a page, or when the next word won't fit in the style's lines.
 */
export function captionPages(words: readonly Word[], range: { start: number; end: number }, style: Pick<CaptionStyle, 'lines' | 'maxChars' | 'uppercase'>): CaptionPage[] {
  const pages: CaptionPage[] = [];
  let current: CaptionWord[] = [];
  let previous: Word | undefined;
  let reached = -Infinity;
  for (const w of words) {
    if (!inCaptions(w, range)) continue;
    reached = Math.max(reached, w.start);
    const word: CaptionWord = { text: style.uppercase ? w.text.toUpperCase() : w.text, start: reached, end: Math.max(reached, w.end) };
    const breaks =
      previous !== undefined &&
      (w.pageBreak === true ||
        endsSentence(previous.text) ||
        w.start - previous.end > PAGE_GAP_SECONDS ||
        greedyLines([...current, word], style.maxChars).length > style.lines);
    if (breaks && current.length > 0) {
      pages.push(page(current, style));
      current = [];
    }
    current.push(word);
    previous = w;
  }
  if (current.length > 0) pages.push(page(current, style));
  return pages;
}

/** The lines of a page, as lists of its words. */
export function pageLines(page: CaptionPage): CaptionWord[][] {
  return page.lineStarts.map((from, i) => page.words.slice(from, page.lineStarts[i + 1] ?? page.words.length));
}

/** What's on screen at `t`, or null when no caption is. */
export function captionStateAt(pages: readonly CaptionPage[], t: number): CaptionState | null {
  let lo = 0;
  let hi = pages.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pages[mid]!.start <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const p = pages[found];
  if (!p) return null;
  const until = Math.min(pages[found + 1]?.start ?? Infinity, p.end + PAGE_HOLD_SECONDS);
  if (t >= until) return null;
  let active = 0;
  while (active + 1 < p.words.length && p.words[active + 1]!.start <= t) active++;
  return { page: found, active, sincePage: t - p.start };
}

/** The band of the output, in pixels from the top, the caption block takes when it has all its lines. */
export function captionBox(style: Pick<CaptionStyle, 'size' | 'lines'>, y: number, outputHeight: number): { top: number; bottom: number } {
  const half = (style.lines * style.size * LINE_HEIGHT) / 2;
  const middle = y * outputHeight;
  return { top: middle - half, bottom: middle + half };
}

/**
 * Where the captions sit at time `t`, given the picture's layouts. Captions
 * still in their default place keep clear of the faces in Split; once moved
 * or keyframed they stay where the user put them, in every layout.
 */
export function captionYAt(y: Animated<number>, layouts: Animated<PictureLayout>, t: number): number {
  const untouched = y.length === 1 && y[0]!.value === DEFAULT_CAPTION_Y;
  return untouched && valueAt(layouts, t) === 'split' ? SPLIT_CAPTION_Y : valueAt(y, t);
}

export function newCaptionLayer(t: number, style: CaptionStyle, id: string = crypto.randomUUID()): CaptionLayer {
  return { id, kind: 'caption', style, y: [{ t, value: DEFAULT_CAPTION_Y, ease: 'cut' }] };
}
