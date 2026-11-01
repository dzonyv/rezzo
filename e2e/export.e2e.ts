/**
 * Exporting a clip: every frame reaches the file exactly once and in order,
 * the file looks like the preview, layout changes land on the right frame,
 * and a cancelled export leaves nothing behind. The source shows each
 * frame's number, so the test reads back which frame ended up where.
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultVideoLayer } from '../src/shared/framing.ts';
import type { Clip, Project } from '../src/shared/project.ts';
import {
  answerOpenDialog, answerSaveDialog, ffmpegExe, ffprobeExe, launchApp, makeNumberedVideo, NUMBER_BIT_WIDTH, NUMBER_STRIP_HEIGHT, stopApp,
} from './helpers.ts';

const run = promisify(execFile);

/** `window` inside page.evaluate(); this config has no DOM types. */
type PageGlobal = typeof globalThis & { __rezzoPreview?: { readRow(y: number): number[] } };

const W = 1080;
const H = 1920;
/** The clip: source frames 147..209 (4.9 s to 7 s at 30 fps), Full frame until 6 s, then Follow. */
const FIRST = 147;
const COUNT = 63;
const SWITCH = 180;
/** A second clip long enough (about a minute) to cancel partway through. */
const LONG_COUNT = 1794;

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

function clip(name: string, start: number, end: number, layout: [number, 'full' | 'follow'][]): Clip {
  const layer = defaultVideoLayer(start);
  layer.layout = layout.map(([t, value]) => ({ t, value, ease: 'cut' }));
  return { id: crypto.randomUUID(), name, start, end, layers: [layer] };
}

/** The luma plane of every frame of `file`, exactly as encoded. */
async function lumaFrames(file: string): Promise<Buffer[]> {
  const { stdout } = await run(ffmpegExe(), ['-v', 'error', '-i', file, '-map', '0:v', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1'], {
    encoding: 'buffer',
    maxBuffer: 1 << 30,
  });
  const size = W * H * 1.5;
  const frames: Buffer[] = [];
  for (let o = 0; o + size <= stdout.length; o += size) frames.push(stdout.subarray(o, o + W * H));
  return frames;
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
    segments: [{ start: 5, end: 5.4, words: [{ text: 'Dobro', start: 5, end: 5.4, p: 0.9 }] }],
  };
  project.clips = [
    clip('Kratki', FIRST / 30, (FIRST + COUNT) / 30, [[FIRST / 30, 'full'], [SWITCH / 30, 'follow']]),
    clip('Dugi', 0.1, 0.1 + LONG_COUNT / 30, [[0.1, 'full']]),
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

  it('writes the clip and says so', async () => {
    await exportFromList('Kratki', out());
    await page.getByRole('heading', { name: 'Clip exported' }).waitFor({ timeout: 60_000 });
    expect(await page.locator('.export-dialog p').textContent()).toMatch(/^kratki\.mp4, in [\d.]+ s on the (graphics card|processor)\.$/);
    await page.locator('.export-dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await expect.poll(() => page.locator('.export-dialog[open]').count()).toBe(0);
    frames = await lumaFrames(out());
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
    // The preview shows the clip's first frame once it's ready.
    const rows = [100, fullRow, 960, 1500];
    let preview: number[][] = [];
    await expect
      .poll(async () => {
        preview = await page.evaluate((ys) => ys.map((y) => (globalThis as PageGlobal).__rezzoPreview?.readRow(y) ?? []), rows);
        return preview.every((r) => r.length === W * 4) && fullNumberFromRgba(preview[1]!) === FIRST;
      }, { timeout: 20_000 })
      .toBe(true);

    let squared = 0;
    let n = 0;
    rows.forEach((y, r) => {
      for (let x = 0; x < W; x++) {
        const [R, G, B] = [preview[r]![x * 4]!, preview[r]![x * 4 + 1]!, preview[r]![x * 4 + 2]!];
        const expected = 16 + (219 * (0.2126 * R + 0.7152 * G + 0.0722 * B)) / 255;
        squared += (frames[0]![y * W + x]! - expected) ** 2;
        n++;
      }
    });
    const psnr = 10 * Math.log10(255 ** 2 / Math.max(squared / n, 1e-9));
    expect(psnr).toBeGreaterThan(40);
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
});

/** fullNumber() on an RGBA row from the preview. */
function fullNumberFromRgba(row: number[]): number {
  let n = 0;
  for (let b = 0; b < 16; b++) if (row[Math.round((b + 0.5) * NUMBER_BIT_WIDTH * FULL_SCALE) * 4]! > 128) n |= 1 << b;
  return n;
}
