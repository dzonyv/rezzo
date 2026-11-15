/**
 * Covers: the Cover tool turning the editor to the cover, framing it on
 * its own and picking its moment, a title on it that the clip doesn't
 * get, the saved project, and the PNG and JPG drawn as the preview is.
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
    segments: [{ start: 2.1, end: 2.5, words: [{ text: 'Naslov.', start: 2.1, end: 2.5, p: 0.9 }] }],
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
});
