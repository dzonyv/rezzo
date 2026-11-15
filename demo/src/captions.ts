/**
 * The captions over the footage: our Serbian translation of the film's
 * English subtitles (TOS-en.srt from download.blender.org), with the same
 * times and each line's words spread evenly over its time. Times are seconds
 * in the film. The film has no Serbian subtitles of its own.
 */
const LINES: [number, number, string][] = [
  [25.0, 27.0, 'Slušaj, Celia, moramo da sledimo svoje strasti;'],
  [27.0, 30.5, 'ti imaš svoju robotiku, a ja samo želim da budem neverovatan u svemiru.'],
  [30.8, 34.0, 'Zašto ne priznaš da te plaši moja robotska ruka?'],
  [34.5, 36.0, 'Ne plaši me, nego...'],
  [37.0, 38.0, 'Dobro! U redu!'],
];

export interface Word {
  text: string;
  start: number;
  end: number;
}

export interface Page {
  lines: Word[][];
  start: number;
  end: number;
}

/** Two lines a page like the app's default style, but 16 characters a line instead of 18 so the word boxes fit. */
const MAX_CHARS = 16;
const MAX_LINES = 2;

function words(): Word[][] {
  return LINES.map(([start, end, text]) => {
    const parts = text.split(' ');
    const step = (end - start) / parts.length;
    return parts.map((part, i) => ({ text: part, start: start + i * step, end: start + (i + 1) * step }));
  });
}

/** Splits each subtitle line into pages; a page never runs across two subtitle lines. */
export function captionPages(): Page[] {
  const pages: Page[] = [];
  for (const line of words()) {
    let page: Word[][] = [[]];
    const flush = () => {
      const all = page.flat();
      if (all.length) pages.push({ lines: page.filter((l) => l.length), start: all[0]!.start, end: all.at(-1)!.end });
      page = [[]];
    };
    for (const word of line) {
      const current = page.at(-1)!;
      const length = current.map((w) => w.text).join(' ').length;
      if (current.length && length + 1 + word.text.length > MAX_CHARS) {
        if (page.length === MAX_LINES) flush();
        else page.push([]);
      }
      page.at(-1)!.push(word);
    }
    flush();
  }
  // A page stays up until the next one starts, if that's soon, so captions don't blink.
  for (let i = 0; i < pages.length - 1; i++) {
    const next = pages[i + 1]!;
    if (next.start - pages[i]!.end < 0.6) pages[i]!.end = next.start;
  }
  return pages;
}
