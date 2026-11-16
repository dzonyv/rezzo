/**
 * Covers: the Cover tool turning the editor to the cover, framing it on
 * its own and picking its moment, a title on it that the clip doesn't
 * get, the saved project, and the PNG and JPG drawn as the preview is;
 * the cover on the exported video's first frames, and the safe zones.
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultVideoLayer, valueAt } from '../src/shared/framing.ts';
import { MAX_JPG_BYTES } from '../src/shared/cover.ts';
import { videoLayerOf, type Project } from '../src/shared/project.ts';
import { analysisDone, answerOpenDialog, answerSaveDialog, ffmpegExe, launchApp, makeNumberedVideo, NUMBER_BIT_WIDTH, NUMBER_STRIP_HEIGHT, openTool, stopApp, until } from './helpers.ts';

const run = promisify(execFile);

/** `window` inside page.evaluate(); this config has no DOM types. */
type PageGlobal = typeof globalThis & { __rezzoPreview?: { readRow(y: number): number[] } };

const W = 1080;
const H = 1920;
/** The clip: 2 s to 6 s of the source, at 30 fps. */
const START = 2;
const END = 6;
/** A new title on the cover is centred across, its middle 0.4 of the way down: on the picture in Full. */
const TITLE_ROW = Math.round(0.4 * H);
/** Full: the 1280×720 source scaled to 1080 wide and centred, so its number strip sits here. */
const SCALE = W / 1280;
const NUMBER_ROW = Math.round((H - 720 * SCALE) / 2 + (NUMBER_STRIP_HEIGHT / 2) * SCALE);
const bitX = (b: number) => Math.round((b + 0.5) * NUMBER_BIT_WIDTH * SCALE);

let dir: string;
let app: ElectronApplication | undefined;
let page: Page;
let file: string;

const previewRow = (y: number) => page.evaluate((r) => (globalThis as PageGlobal).__rezzoPreview?.readRow(r) ?? [], y);

/** The source frame on screen in Full, from its number strip. */
async function frameOnScreen(): Promise<number> {
  const row = await previewRow(NUMBER_ROW);
  let n = 0;
  for (let b = 0; b < 16; b++) if (row[bitX(b) * 4]! > 128) n |= 1 << b;
  return n;
}

/** How many pixels of the preview's title row are white (letters) and black (outline). */
async function inks(): Promise<{ white: number; black: number }> {
  const row = await previewRow(TITLE_ROW);
  let white = 0;
  let black = 0;
  for (let x = 0; x < W; x++) {
    const [r, g, b] = [row[x * 4]!, row[x * 4 + 1]!, row[x * 4 + 2]!];
    if (r > 220 && g > 220 && b > 220) white++;
    if (r < 40 && g < 40 && b < 40) black++;
  }
  return { white, black };
}

async function saved(): Promise<Project> {
  await page.keyboard.press('Control+S');
  await expect.poll(() => page.locator('.topbar .dirty').count()).toBe(0);
  return JSON.parse(await readFile(file, 'utf8')) as Project;
}

/** A picture file as grey levels, one byte a pixel, top row first. */
async function luma(picture: string): Promise<Buffer> {
  const { stdout } = await run(ffmpegExe(), ['-v', 'error', '-i', picture, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 26 });
  return stdout;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-e2e-'));
  const video = await makeNumberedVideo(path.join(dir, 'numbered.mp4'), { seconds: 10 });
  await mkdir(path.join(dir, 'out'));

  ({ app, page } = await launchApp(dir));
  await answerOpenDialog(app, video);
  await page.getByRole('button', { name: 'New project' }).click();
  file = path.join(dir, 'numbered.rezzo');
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
    segments: [
      {
        start: 2.1,
        end: 2.9,
        words: [
          { text: 'Ona', start: 2.1, end: 2.4, p: 0.9 },
          { text: 'laže.', start: 2.5, end: 2.9, p: 0.9 },
        ],
      },
    ],
  };
  project.clips = [{ id: crypto.randomUUID(), name: 'Naslovna', start: START, end: END, skips: [], evenLoudness: false, layers: [defaultVideoLayer(START)] }];
  await writeFile(file, JSON.stringify(project));
  await page.getByRole('button', { name: /numbered/ }).click();
  await page.locator('.clip-list li', { hasText: 'Naslovna' }).getByRole('button', { name: 'Naslovna' }).click();
  await until(async () => (await previewRow(0)).length > 0, 20_000);
  await analysisDone(page);
});

afterAll(async () => {
  await stopApp(app);
  await rm(dir, { recursive: true, force: true });
});

describe('covers', () => {
  it('frames the cover on its own and picks its moment', async () => {
    await openTool(page, 'Cover');
    await page.locator('.clip-editor .cover-moment').waitFor();
    await page.locator('.layouts').getByRole('button', { name: 'Full' }).click();
    await expect.poll(frameOnScreen, { timeout: 10_000 }).toBe(START * 30);
    // A second and three frames on.
    await page.keyboard.press('Shift+ArrowRight');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await expect.poll(frameOnScreen, { timeout: 10_000 }).toBe(93);
  });

  it('puts a title on the cover, not on the clip', async () => {
    expect(await inks()).toEqual({ white: 0, black: 0 });
    await page.locator('.clip-drawer .add-tiles').getByRole('button', { name: 'Text' }).click();
    await page.getByRole('heading', { name: 'Text: Your title here' }).waitFor();
    await expect.poll(async () => (await inks()).white, { timeout: 10_000 }).toBeGreaterThan(20);
    expect((await inks()).black).toBeGreaterThan(20);

    // Back on the clip: its own framing (Follow), no title, nothing on its timeline.
    await openTool(page, 'Layers');
    await page.locator('.clip-timeline').waitFor();
    expect(await page.locator('.clip-timeline .layer-bar').count()).toBe(0);
    await expect.poll(async () => (await inks()).white, { timeout: 10_000 }).toBe(0);
  });

  it('keeps the cover in the saved project', async () => {
    const project = await saved();
    const clip = project.clips[0]!;
    expect(valueAt(videoLayerOf(clip).layout, 3.1)).toBe('follow');
    expect(clip.layers.map((l) => l.kind)).toEqual(['video']);
    expect(clip.cover).toMatchObject({ time: 3.1, layers: [{ kind: 'text', text: 'Your *title* here' }] });
    expect(clip.cover!.video!.layout).toEqual([expect.objectContaining({ value: 'full' })]);
  });

  it('saves the cover as the preview draws it, as PNG and as a small JPG', async () => {
    await openTool(page, 'Cover');
    await expect.poll(frameOnScreen, { timeout: 10_000 }).toBe(93);
    const png = path.join(dir, 'out', 'naslovna.png');
    await answerSaveDialog(app!, png);
    await page.getByRole('button', { name: 'Save PNG' }).click();
    await page.getByText('Saved the cover as naslovna.png.').waitFor({ timeout: 20_000 });

    const pixels = await luma(png);
    expect(pixels.length).toBe(W * H);
    let n = 0;
    for (let b = 0; b < 16; b++) if (pixels[NUMBER_ROW * W + bitX(b)]! > 128) n |= 1 << b;
    expect(n).toBe(93);
    const row = pixels.subarray(TITLE_ROW * W, (TITLE_ROW + 1) * W);
    expect(row.filter((v) => v > 220).length).toBeGreaterThan(20);
    expect(row.filter((v) => v < 40).length).toBeGreaterThan(20);

    const jpg = path.join(dir, 'out', 'naslovna.jpg');
    await answerSaveDialog(app!, jpg);
    await page.getByRole('button', { name: 'Save JPG' }).click();
    await page.getByText('Saved the cover as naslovna.jpg.').waitFor({ timeout: 20_000 });
    expect((await stat(jpg)).size).toBeLessThanOrEqual(MAX_JPG_BYTES);
    expect((await luma(jpg)).length).toBe(W * H);
  });

  it('suggests frames to choose from', async () => {
    await page.keyboard.press('Escape');
    const frames = page.locator('.cover-frames button');
    await expect.poll(() => frames.count(), { timeout: 20_000 }).toBe(4);
    // Nobody in the test video: they're spread over the clip, none of them the frame the cover has.
    const name = (await frames.and(page.locator('[aria-pressed="false"]')).first().getAttribute('title'))!;
    const other = page.locator(`.cover-frames button[title="${name}"]`);
    await other.click();
    await expect.poll(() => other.getAttribute('aria-pressed')).toBe('true');
    await expect.poll(frameOnScreen, { timeout: 10_000 }).not.toBe(93);
  });

  it('titles the cover with words picked in the transcript', async () => {
    await openTool(page, 'Text');
    const from = (await page.locator('.w', { hasText: 'Ona' }).boundingBox())!;
    const to = (await page.locator('.w', { hasText: 'laže.' }).boundingBox())!;
    await page.mouse.move(from.x + 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 5, to.y + to.height / 2, { steps: 6 });
    await page.mouse.up();
    expect(await page.locator('.w.selected').count()).toBe(2);
    await page.getByRole('button', { name: 'Cover title' }).click();
    await page.getByRole('heading', { name: 'Text: Ona laže' }).waitFor();
    expect(await page.locator('.tool-rail').getByRole('button', { name: 'Cover', exact: true }).getAttribute('aria-pressed')).toBe('true');
    const project = await saved();
    expect(project.clips[0]!.cover!.layers.map((l) => (l.kind === 'text' ? l.text : l.kind))).toEqual(['Your *title* here', 'Ona laže']);
  });

  it("puts the cover on the exported video's first frames", async () => {
    await openTool(page, 'Cover');
    await page.getByRole('checkbox', { name: "Put the cover on the video's first frames" }).check();
    const time = (await saved()).clips[0]!.cover!.time;
    expect((await saved()).clips[0]!.cover!.inVideo).toBe(true);
    const out = path.join(dir, 'out', 'naslovna.mp4');
    await answerSaveDialog(app!, out);
    await page.locator('.clip-editor header').getByRole('button', { name: 'Export' }).click();
    await page.getByRole('heading', { name: 'Clip exported' }).waitFor({ timeout: 60_000 });
    await page.locator('.export-dialog').getByRole('button', { name: 'Close', exact: true }).click();

    const { stdout } = await run(ffmpegExe(), ['-v', 'error', '-i', out, '-map', '0:v', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 30 });
    const size = W * H;
    // As long as the clip: the cover takes the place of its first frames.
    expect(stdout.length / size).toBe((END - START) * 30);
    const frame = (i: number) => stdout.subarray(i * size, (i + 1) * size);
    const number = (luma: Buffer) => {
      let n = 0;
      for (let b = 0; b < 16; b++) if (luma[NUMBER_ROW * W + bitX(b)]! > 128) n |= 1 << b;
      return n;
    };
    const titled = (luma: Buffer) => luma.subarray(TITLE_ROW * W, (TITLE_ROW + 1) * W).filter((v) => v > 220).length > 20;
    // A tenth of a second at 30 fps: three frames of the cover (in Full, its moment, with the titles), then the clip.
    for (let i = 0; i < 3; i++) {
      expect(number(frame(i))).toBe(Math.round(time * 30));
      expect(titled(frame(i))).toBe(true);
    }
    expect(titled(frame(3))).toBe(false);
  });

  it("shows a platform's safe zones over the preview, and Instagram's grid on the cover", async () => {
    const zones = page.getByRole('combobox', { name: 'Safe zones' });
    await zones.selectOption('tiktok');
    await page.locator('.safe-zones .clear').waitFor();
    expect(await page.locator('.safe-zones .grid-crop').count()).toBe(0);
    await zones.selectOption('reels');
    await page.locator('.safe-zones .grid-crop').waitFor();
    await zones.selectOption('off');
    await expect.poll(() => page.locator('.safe-zones').count()).toBe(0);
  });
});
