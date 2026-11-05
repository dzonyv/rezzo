import { describe, expect, it } from 'vitest';
import { DEFAULT_CAPTION_STYLE } from './caption-style.ts';
import {
  captionBox, captionPages, captionStateAt, captionYAt, DEFAULT_CAPTION_Y, newCaptionLayer, pageLines, PAGE_HOLD_SECONDS, SPLIT_CAPTION_Y, type CaptionPage,
} from './captions.ts';
import type { Animated, Layout, Word } from './project.ts';

/** Words of `text`, each 0.3 s long with 0.05 s between them, from `at`. */
function words(text: string, at = 0): Word[] {
  return text.split(' ').map((t, i) => ({ text: t, start: at + i * 0.35, end: at + i * 0.35 + 0.3, p: 0.9 }));
}

const style = { ...DEFAULT_CAPTION_STYLE, uppercase: false, lines: 2 as const, maxChars: 16 };
const all = { start: 0, end: 100 };
const texts = (pages: CaptionPage[]) => pages.map((p) => pageLines(p).map((l) => l.map((w) => w.text).join(' ')));

describe('captionPages', () => {
  it('takes the words whose middle is in the clip', () => {
    const w = words('jedan dva tri četiri');
    // "dva" (0.35..0.65) starts before the clip but its middle is in it; "četiri" (1.05..1.35) is the other way round.
    expect(texts(captionPages(w, { start: 0.4, end: 1.1 }, style))).toEqual([['dva tri']]);
  });

  it('starts a page after a sentence ends', () => {
    expect(texts(captionPages(words('Dobro veče. Kako ste?'), all, style))).toEqual([['Dobro veče.'], ['Kako ste?']]);
  });

  it('starts a page after a pause', () => {
    const w = [...words('prvo'), ...words('drugo', 2)];
    expect(texts(captionPages(w, all, style))).toEqual([['prvo'], ['drugo']]);
  });

  it('starts a page where the user asked for one', () => {
    const w = words('jedan dva tri');
    w[2]!.pageBreak = true;
    expect(texts(captionPages(w, all, style))).toEqual([['jedan dva'], ['tri']]);
  });

  it('fills two lines, then goes on to a new page', () => {
    const pages = captionPages(words('ovo je jedna malo duža rečenica koja ne staje na jednu stranu'), all, style);
    for (const p of pages) {
      const lines = pageLines(p);
      expect(lines.length).toBeLessThanOrEqual(2);
      for (const l of lines) expect(l.map((w) => w.text).join(' ').length).toBeLessThanOrEqual(16);
    }
    expect(pages.flatMap((p) => p.words.map((w) => w.text)).join(' ')).toBe('ovo je jedna malo duža rečenica koja ne staje na jednu stranu');
  });

  it('breaks two lines evenly', () => {
    // Filling the first line up would give "jedan dva tri" / "x".
    expect(texts(captionPages(words('jedan dva tri četiri'), all, style))).toEqual([['jedan dva', 'tri četiri']]);
  });

  it('keeps a page on one line when it fits', () => {
    expect(texts(captionPages(words('kratko je'), all, style))).toEqual([['kratko je']]);
  });

  it('gives a word too long for a line a line of its own', () => {
    expect(texts(captionPages(words('najneverovatnijima ikad'), all, { ...style, lines: 1, maxChars: 8 }))).toEqual([['najneverovatnijima'], ['ikad']]);
  });

  it('writes capitals when the style says so, Đ and DŽ included', () => {
    expect(texts(captionPages(words('đak džep'), all, { ...style, uppercase: true }))).toEqual([['ĐAK DŽEP']]);
  });

  it('never lets a word count as spoken before the one ahead of it', () => {
    const w = words('jedan dva', 1);
    w[1]!.start = 0.9;
    const [p] = captionPages(w, all, style);
    expect(p!.words[1]!.start).toBe(1);
  });
});

describe('captionStateAt', () => {
  const pages = captionPages([...words('Dobro veče.'), ...words('Kako ste', 1)], all, style);

  it('shows nothing before the first word', () => {
    expect(captionStateAt(pages, -0.1)).toBeNull();
  });

  it('marks the word being spoken', () => {
    expect(captionStateAt(pages, 0.1)).toMatchObject({ page: 0, active: 0 });
    expect(captionStateAt(pages, 0.35)).toMatchObject({ page: 0, active: 1 });
    // Between words the last one to start stays marked.
    expect(captionStateAt(pages, 0.32)).toMatchObject({ page: 0, active: 0 });
  });

  it('keeps a page up until the next one', () => {
    // "veče." ends at 0.65 and the next page starts at 1.
    expect(captionStateAt(pages, 0.9)).toMatchObject({ page: 0, active: 1 });
    expect(captionStateAt(pages, 1)).toMatchObject({ page: 1, active: 0, sincePage: 0 });
  });

  it('takes a page down a little after its last word when nothing follows', () => {
    const end = pages[1]!.end;
    expect(captionStateAt(pages, end + PAGE_HOLD_SECONDS - 0.01)).not.toBeNull();
    expect(captionStateAt(pages, end + PAGE_HOLD_SECONDS)).toBeNull();
  });
});

describe('captionBox', () => {
  it('is centred on y, as tall as the lines', () => {
    expect(captionBox({ size: 100, lines: 2 }, 0.5, 1920)).toEqual({ top: 960 - 120, bottom: 960 + 120 });
  });
});

describe('captionYAt', () => {
  const layouts: Animated<Layout> = [
    { t: 0, value: 'follow', ease: 'cut' },
    { t: 2, value: 'split', ease: 'cut' },
    { t: 4, value: 'full', ease: 'cut' },
  ];
  const at = (value: number, t = 0) => ({ t, value, ease: 'cut' as const });

  it("reads Split's own track in Split, and the other one everywhere else", () => {
    const tracks = { y: [at(0.8)], splitY: [at(0.4)] };
    expect(captionYAt(tracks, layouts, 1)).toBe(0.8);
    expect(captionYAt(tracks, layouts, 3)).toBe(0.4);
    expect(captionYAt(tracks, layouts, 5)).toBe(0.8);
  });

  it('follows the keyframes of the track in use', () => {
    const tracks = { y: [at(0.8)], splitY: [at(0.4), at(0.6, 3)] };
    expect(captionYAt(tracks, layouts, 2.5)).toBe(0.4);
    expect(captionYAt(tracks, layouts, 3.5)).toBe(0.6);
  });

  it('starts new captions off the lower face in Split', () => {
    const layer = newCaptionLayer(0, DEFAULT_CAPTION_STYLE);
    expect(captionYAt(layer, layouts, 1)).toBe(DEFAULT_CAPTION_Y);
    expect(captionYAt(layer, layouts, 3)).toBe(SPLIT_CAPTION_Y);
  });
});
