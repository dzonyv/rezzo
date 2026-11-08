/**
 * Exporting a clip: every frame reaches the file exactly once and in order,
 * the file looks like the preview, layout changes and caption highlights
 * land on the right frame, captions use the chosen font, and a cancelled
 * export leaves nothing behind. The source shows each frame's number, so
 * the test reads back which frame ended up where.
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CAPTION_STYLE } from '../src/shared/caption-style.ts';
import { newCaptionLayer } from '../src/shared/captions.ts';
import { defaultVideoLayer } from '../src/shared/framing.ts';
import type { Clip, Project } from '../src/shared/project.ts';
import {
  analysisDone,
  answerOpenDialog,
  answerSaveDialog,
  ffmpegExe,
  ffprobeExe,
  launchApp,
  makeNumberedVideo,
  NUMBER_BIT_WIDTH,
  NUMBER_STRIP_HEIGHT,
  openTool,
  renamedFont,
  stopApp,
} from './helpers.ts';

const run = promisify(execFile);

/** `window` inside page.evaluate(); this config has no DOM types. */
type PageGlobal = typeof globalThis & { __rezzoPreview?: { readRow(y: number): number[] } };
type FontsGlobal = { document: { fonts: { check(font: string): boolean } } };

const W = 1080;
const H = 1920;
/** The clip: source frames 147..209 (4.9 s to 7 s at 30 fps), Full frame until 6 s, then Follow. */
const FIRST = 147;
const COUNT = 63;
const SWITCH = 180;
/** A second clip long enough (about a minute) to cancel partway through. */
const LONG_COUNT = 1794;
/**
 * The short clip's captions, one line "DOBRO VEČE SVIMA" in the default
 * style, centred on row 0.7 × 1920. Each word starts just before a frame:
 * "veče" is spoken from frame 165 on.
 */
const CAPTION_ROW = 1344;
const VECE_FRAME = 165;

let dir: string;
let app: ElectronApplication | undefined;
let page: Page;

/** expect.poll() for hooks, where vitest doesn't allow it. */
async function until(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

function clip(name: string, start: number, end: number, layout: [number, 'full' | 'follow' | 'split'][], captions = false): Clip {
  const layer = defaultVideoLayer(start);
  layer.layout = layout.map(([t, value]) => ({ t, value, ease: 'cut' }));
  const layers: Clip['layers'] = [layer];
  if (captions) layers.push(newCaptionLayer(start, DEFAULT_CAPTION_STYLE));
  return { id: crypto.randomUUID(), name, start, end, skips: [], layers };
}

/** Every frame of `file` as yuv420p, exactly as encoded. */
async function yuvFrames(file: string): Promise<Buffer[]> {
  const { stdout } = await run(ffmpegExe(), ['-v', 'error', '-i', file, '-map', '0:v', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1'], {
    encoding: 'buffer',
    maxBuffer: 1 << 30,
  });
  const size = W * H * 1.5;
  const frames: Buffer[] = [];
  for (let o = 0; o + size <= stdout.length; o += size) frames.push(stdout.subarray(o, o + size));
  return frames;
}

/** The luma plane of every frame of `file`. */
const lumaFrames = async (file: string) => (await yuvFrames(file)).map((f) => f.subarray(0, W * H));

/**
 * Where along the caption row the yellow (spoken) word is: the middle of
 * the columns whose blue-difference is far below grey. Null when no word is.
 */
function yellowAt(yuv: Buffer): number | null {
  const u = yuv.subarray(W * H, W * H + (W / 2) * (H / 2));
  const row = CAPTION_ROW / 2;
  const xs: number[] = [];
  for (let x = 0; x < W / 2; x++) if (u[row * (W / 2) + x]! < 80) xs.push(x * 2);
  return xs.length > 20 ? (xs[0]! + xs.at(-1)!) / 2 : null;
}

/** First and last column of the caption row that's as bright as white text. */
function textExtent(luma: Buffer): [number, number] | null {
  let first = -1;
  let last = -1;
  for (let x = 0; x < W; x++) {
    if (luma[CAPTION_ROW * W + x]! > 200) {
      if (first < 0) first = x;
      last = x;
    }
  }
  return first < 0 ? null : [first, last];
}

/** Reads the frame-number bits `bits` along output row `y`, bit b centred at x(b). */
function readBits(luma: Buffer, y: number, bits: number[], x: (b: number) => number): number {
  let n = 0;
  for (const b of bits) if (luma[y * W + Math.round(x(b))]! > 128) n |= 1 << b;
  return n;
}

/**
 * Full frame: the 1280×720 source scaled to 1080 wide and centred, so the
 * whole number strip is readable.
 */
const FULL_SCALE = W / 1280;
const fullRow = Math.round((H - 720 * FULL_SCALE) / 2 + (NUMBER_STRIP_HEIGHT / 2) * FULL_SCALE);
const fullNumber = (luma: Buffer) => readBits(luma, fullRow, [...Array(16).keys()], (b) => (b + 0.5) * NUMBER_BIT_WIDTH * FULL_SCALE);

/**
 * Follow, centred: a 405×720 crop from x = 437.5 fills the output, so only
 * bits 6 to 9 of the strip are in the picture.
 */
const FOLLOW_SCALE = H / 720;
const FOLLOW_BITS = [6, 7, 8, 9];
const followBits = (luma: Buffer) =>
  readBits(luma, Math.round((NUMBER_STRIP_HEIGHT / 2) * FOLLOW_SCALE), FOLLOW_BITS, (b) => ((b + 0.5) * NUMBER_BIT_WIDTH - 437.5) * FOLLOW_SCALE);
const maskFollow = (n: number) => FOLLOW_BITS.reduce((m, b) => m | (n & (1 << b)), 0);

async function probe(file: string) {
  const { stdout } = await run(ffprobeExe(), [
    '-v', 'error', '-show_entries',
    'stream=codec_type,codec_name,width,height,pix_fmt,color_space,color_primaries,color_transfer,color_range,duration',
    '-of', 'json', file,
  ]);
  return JSON.parse(stdout).streams as Record<string, string | number>[];
}

async function exportFromList(name: string, out: string): Promise<void> {
  await answerSaveDialog(app!, out);
  await page.locator('.clip-list li', { hasText: name }).getByRole('button', { name: 'Export' }).click();
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-e2e-'));
  const video = await makeNumberedVideo(path.join(dir, 'numbered.mp4'), { seconds: 60 });
  await mkdir(path.join(dir, 'out'));

  ({ app, page } = await launchApp(dir));
  await answerOpenDialog(app, video);
  await page.getByRole('button', { name: 'New project' }).click();
  const file = path.join(dir, 'numbered.rezzo');
  await answerSaveDialog(app, file);
  await page.getByRole('textbox', { name: 'Project name' }).waitFor();
  await page.keyboard.press('Control+S');
  await until(async () => (await readFile(file, 'utf8').catch(() => '')).includes('"source"'));
  await page.getByRole('button', { name: 'Close project' }).click();

  const project = JSON.parse(await readFile(file, 'utf8')) as Project;
  project.transcript = {
    language: 'sr',
    model: 'test',
    createdAt: new Date().toISOString(),
    startShift: -0.1,
    segments: [{
      start: 4.99,
      end: 6.6,
      words: [
        { text: 'Dobro', start: 4.99, end: 5.4, p: 0.9 },
        { text: 'veče', start: VECE_FRAME / 30 - 0.01, end: 5.9, p: 0.9 },
        { text: 'svima', start: 6.19, end: 6.6, p: 0.9 },
      ],
    }],
  };
  project.clips = [
    clip('Kratki', FIRST / 30, (FIRST + COUNT) / 30, [[FIRST / 30, 'full'], [SWITCH / 30, 'follow']], true),
    clip('Dugi', 0.1, 0.1 + LONG_COUNT / 30, [[0.1, 'full']]),
    clip('Podeljeni', FIRST / 30, (FIRST + COUNT) / 30, [[FIRST / 30, 'split']], true),
  ];
  await writeFile(file, JSON.stringify(project));
  await page.getByRole('button', { name: /numbered/ }).click();
  await page.locator('.clip-list li').first().waitFor();
});

afterAll(async () => {
  await stopApp(app);
  await rm(dir, { recursive: true, force: true });
});

describe('export', () => {
  const out = () => path.join(dir, 'out', 'kratki.mp4');
  let frames: Buffer[];
  let yuv: Buffer[];

  it('writes the clip and says so', async () => {
    await exportFromList('Kratki', out());
    await page.getByRole('heading', { name: 'Clip exported' }).waitFor({ timeout: 60_000 });
    expect(await page.locator('.export-dialog p').textContent()).toMatch(/^kratki\.mp4, in [\d.]+ s on the (graphics card|processor)\.$/);
    // Beside it, the clip's picture, with the curtain gone.
    await expect.poll(() => page.locator('.export-picture .thumb img').evaluate((img: { naturalWidth: number }) => img.naturalWidth), { timeout: 20_000 }).toBeGreaterThan(0);
    expect(await page.locator('.export-picture .curtain').count()).toBe(0);
    await page.locator('.export-dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await expect.poll(() => page.locator('.export-dialog[open]').count()).toBe(0);
    yuv = await yuvFrames(out());
    frames = yuv.map((f) => f.subarray(0, W * H));
  });

  it('has every frame of the clip once, in order', () => {
    expect(frames).toHaveLength(COUNT);
    frames.forEach((luma, i) => {
      if (FIRST + i < SWITCH) expect(fullNumber(luma), `frame ${i}`).toBe(FIRST + i);
      else expect(followBits(luma), `frame ${i}`).toBe(maskFollow(FIRST + i));
    });
  });

  it('switches layout on the keyframe', () => {
    // Full frame has the blurred background above the picture; Follow fills it with the source.
    const topRowMean = (luma: Buffer) => luma.subarray(300 * W, 301 * W).reduce((a, b) => a + b, 0) / W;
    expect(Math.abs(topRowMean(frames[SWITCH - FIRST - 1]!) - 128)).toBeGreaterThan(20);
    expect(Math.abs(topRowMean(frames[SWITCH - FIRST]!) - 128)).toBeLessThan(4);
  });

  it('looks like the preview', async () => {
    await page.locator('.clip-list li', { hasText: 'Kratki' }).getByRole('button', { name: 'Kratki' }).click();
    await analysisDone(page);
    // The preview shows the clip's first frame once it's ready.
    const rows = [100, fullRow, 960, 1500];
    let preview: number[][] = [];
    await expect
      .poll(async () => {
        preview = await page.evaluate((ys) => ys.map((y) => (globalThis as PageGlobal).__rezzoPreview?.readRow(y) ?? []), rows);
        return preview.every((r) => r.length === W * 4) && fullNumberFromRgba(preview[1]!) === FIRST;
      }, { timeout: 20_000 })
      .toBe(true);

    expect(psnr(preview, rows, frames[0]!)).toBeGreaterThan(40);
  });

  it('draws the captions, marking each word from the frame it starts on', () => {
    // Before the first word: no captions.
    expect(textExtent(frames[0]!)).toBeNull();
    expect(yellowAt(yuv[0]!)).toBeNull();
    // "DOBRO" is spoken first, on the left of the line; "VEČE" in the middle.
    const before = yellowAt(yuv[VECE_FRAME - 1 - FIRST]!);
    const from = yellowAt(yuv[VECE_FRAME - FIRST]!);
    expect(before).not.toBeNull();
    expect(before!).toBeLessThan(400);
    expect(from!).toBeGreaterThan(420);
    expect(from!).toBeLessThan(660);
    expect(textExtent(frames[VECE_FRAME - FIRST]!)).not.toBeNull();
  });

  it('draws the captions as the preview does', async () => {
    // The export waited for the font, so it was never drawn in a stand-in.
    expect(await page.evaluate(() => (globalThis as unknown as FontsGlobal).document.fonts.check('700 64px Poppins'))).toBe(true);
    // From the first frame, step to the one where "veče" is spoken.
    for (let i = 0; i < VECE_FRAME - FIRST; i++) await page.keyboard.press('ArrowRight');
    const rows = [fullRow, CAPTION_ROW - 20, CAPTION_ROW - 8, CAPTION_ROW, CAPTION_ROW + 8, CAPTION_ROW + 20];
    let preview: number[][] = [];
    await expect
      .poll(async () => {
        preview = await page.evaluate((ys) => ys.map((y) => (globalThis as PageGlobal).__rezzoPreview?.readRow(y) ?? []), rows);
        return fullNumberFromRgba(preview[0]!) === VECE_FRAME && preview[3]!.some((v, i) => i % 4 === 0 && v > 230);
      }, { timeout: 20_000 })
      .toBe(true);
    expect(psnr(preview.slice(1), rows.slice(1), frames[VECE_FRAME - FIRST]!)).toBeGreaterThan(40);
  });

  it('is a 1080×1920 H.264 file tagged BT.709, with the sound', async () => {
    const streams = await probe(out());
    const video = streams.find((s) => s.codec_type === 'video')!;
    const audio = streams.find((s) => s.codec_type === 'audio')!;
    expect(video).toMatchObject({
      codec_name: 'h264', width: W, height: H, pix_fmt: 'yuv420p',
      color_space: 'bt709', color_primaries: 'bt709', color_transfer: 'bt709', color_range: 'tv',
    });
    expect(audio.codec_name).toBe('aac');
    expect(Math.abs(Number(audio.duration) - COUNT / 30)).toBeLessThan(1 / 30 + 0.025);
  });

  it('asks before closing the window during an export, and leaves nothing behind when cancelled', async () => {
    const target = path.join(dir, 'out', 'dugi.mp4');
    await exportFromList('Dugi', target);
    // While frames are being rendered and encoded:
    await page.locator(`.export-dialog progress[max="${LONG_COUNT}"]`).waitFor({ timeout: 30_000 });
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    await page.getByRole('heading', { name: 'An export is running' }).waitFor();
    await page.getByRole('button', { name: 'Keep exporting' }).click();
    expect(await page.locator('.export-dialog[open] progress[max]').count()).toBe(1);
    // The curtain over the picture has drawn back as far as the frames have come.
    const curtainAt = () => page.locator('.export-picture .curtain').evaluate((el: { style: { left: string } }) => parseFloat(el.style.left) / 100);
    await expect.poll(curtainAt).toBeGreaterThan(0);
    const drawn = Number(await page.locator('.export-dialog progress').getAttribute('value')) / LONG_COUNT;
    expect(Math.abs((await curtainAt()) - drawn)).toBeLessThan(0.2);

    await page.locator('.export-dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect.poll(() => page.locator('.export-dialog[open]').count(), { timeout: 20_000 }).toBe(0);
    await expect.poll(async () => (await readdir(path.join(dir, 'out'))).sort()).toEqual(['kratki.mp4']);
  });

  it('exports again after a cancel', async () => {
    // The short clip: the long one takes minutes in CI, without a GPU.
    const target = path.join(dir, 'out', 'kratki-2.mp4');
    await exportFromList('Kratki', target);
    await page.getByRole('heading', { name: 'Clip exported' }).waitFor({ timeout: 60_000 });
    await page.locator('.export-dialog').getByRole('button', { name: 'Close', exact: true }).click();
    const { stdout } = await run(ffprobeExe(), ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', target]);
    expect(Number(stdout.trim())).toBe(COUNT);
  });

  it('exports captions in Split on the line between the halves', async () => {
    const target = path.join(dir, 'out', 'podeljeni.mp4');
    await exportFromList('Podeljeni', target);
    await page.getByRole('heading', { name: 'Clip exported' }).waitFor({ timeout: 60_000 });
    await page.locator('.export-dialog').getByRole('button', { name: 'Close', exact: true }).click();
    const luma = (await lumaFrames(target))[VECE_FRAME - FIRST]!;
    const bright = (row: number) => luma.subarray(row * W, (row + 1) * W).filter((v) => v > 200).length;
    // Just above the middle: right below it the lower half starts with the number strip.
    expect(bright(H / 2 - 15)).toBeGreaterThan(0);
    expect(bright(CAPTION_ROW)).toBe(0);
  });

  it('exports captions in a font the user added', async () => {
    // Anton under another name, so it isn't one of the bundled fonts.
    const font = await renamedFont(path.resolve('src/renderer/src/fonts/anton/Anton-Regular.ttf'), path.join(dir, 'probe.ttf'), 'Anton', 'Probe');
    await page.locator('.clip-list li', { hasText: 'Kratki' }).getByRole('button', { name: 'Kratki' }).click();
    await openTool(page, 'Captions');
    await answerOpenDialog(app!, font);
    await page.getByRole('button', { name: 'Add font…' }).click();
    await page.getByText('Added Probe.').waitFor();
    expect(await page.getByRole('combobox', { name: 'Font' }).inputValue()).toBe('Probe');

    const target = path.join(dir, 'out', 'probe.mp4');
    await exportFromList('Kratki', target);
    await page.getByRole('heading', { name: 'Clip exported' }).waitFor({ timeout: 60_000 });
    await page.locator('.export-dialog').getByRole('button', { name: 'Close', exact: true }).click();
    // Anton is a narrow font: the same words take much less room than in Poppins Bold.
    const frame = VECE_FRAME - FIRST;
    const [a, b] = textExtent((await lumaFrames(target))[frame]!)!;
    const [c, d] = textExtent(frames[frame]!)!;
    expect(b - a).toBeLessThan((d - c) * 0.8);
  });

  it('falls back to Poppins Bold, and says so, when the font is missing', async () => {
    const file = path.join(dir, 'numbered.rezzo');
    await answerSaveDialog(app!, file);
    await page.keyboard.press('Control+S');
    await expect.poll(() => page.locator('.topbar .dirty').count()).toBe(0);
    await page.getByRole('button', { name: 'Close project' }).click();
    const project = JSON.parse(await readFile(file, 'utf8')) as Project;
    for (const layer of project.clips[0]!.layers) if (layer.kind === 'caption') layer.style.font = { family: 'Nema Ga', weight: 700 };
    await writeFile(file, JSON.stringify(project));

    await page.getByRole('button', { name: /numbered/ }).click();
    await page.locator('.clip-list li', { hasText: 'Kratki' }).getByRole('button', { name: 'Kratki' }).click();
    await openTool(page, 'Captions');
    await page.getByText("Nema Ga 700 isn't on this computer, so these captions are drawn in Poppins Bold.", { exact: false }).waitFor();
  });
});

/** How close RGBA rows of the preview are to the same rows of an exported luma plane. */
function psnr(preview: number[][], rows: number[], luma: Buffer): number {
  let squared = 0;
  let n = 0;
  rows.forEach((y, r) => {
    for (let x = 0; x < W; x++) {
      const [R, G, B] = [preview[r]![x * 4]!, preview[r]![x * 4 + 1]!, preview[r]![x * 4 + 2]!];
      const expected = 16 + (219 * (0.2126 * R + 0.7152 * G + 0.0722 * B)) / 255;
      squared += (luma[y * W + x]! - expected) ** 2;
      n++;
    }
  });
  return 10 * Math.log10(255 ** 2 / Math.max(squared / n, 1e-9));
}

/** fullNumber() on an RGBA row from the preview. */
function fullNumberFromRgba(row: number[]): number {
  let n = 0;
  for (let b = 0; b < 16; b++) if (row[Math.round((b + 0.5) * NUMBER_BIT_WIDTH * FULL_SCALE) * 4]! > 128) n |= 1 << b;
  return n;
}
