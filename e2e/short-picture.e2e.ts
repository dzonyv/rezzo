/**
 * A source whose sound runs a few frames past its picture: a clip reaching
 * its end holds the last picture for the rest, in the paused preview and
 * the export, with layers going on over it.
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_MOTION } from '../src/shared/cover.ts';
import { defaultVideoLayer } from '../src/shared/framing.ts';
import type { Project, TextLayer } from '../src/shared/project.ts';
import { DEFAULT_TEXT_STYLE } from '../src/shared/text-style.ts';
import { analysisDone, answerOpenDialog, answerSaveDialog, ffmpegExe, launchApp, makeNumberedVideo, NUMBER_BIT_WIDTH, NUMBER_STRIP_HEIGHT, stopApp, until } from './helpers.ts';

const run = promisify(execFile);

/** `window` inside page.evaluate(); this config has no DOM types. */
type PageGlobal = typeof globalThis & { __rezzoPreview?: { readRow(y: number): number[] } };

const W = 1080;
const H = 1920;
/** The picture: 4 s at 30 fps, frames 0 to 119; the sound runs 0.1 s (3 frames) longer. */
const PICTURE = 4;
const LAST_FRAME = PICTURE * 30 - 1;
const START = 2;
/** Text over the frames past the picture only, its middle 0.4 of the way down. */
const TEXT_ROW = Math.round(0.4 * H);
/** Full: the 1280×720 source scaled to 1080 wide and centred, so its number strip sits here. */
const SCALE = W / 1280;
const NUMBER_ROW = Math.round((H - 720 * SCALE) / 2 + (NUMBER_STRIP_HEIGHT / 2) * SCALE);
const bitX = (b: number) => Math.round((b + 0.5) * NUMBER_BIT_WIDTH * SCALE);

let dir: string;
let app: ElectronApplication | undefined;
let page: Page;
/** The clip's last frame + 1, past the picture's end. */
let frames: number;

const numberOf = (row: ArrayLike<number>, stride: number) => {
  let n = 0;
  for (let b = 0; b < 16; b++) if (row[bitX(b) * stride]! > 128) n |= 1 << b;
  return n;
};
const whiteIn = (row: ArrayLike<number>, stride: number) => {
  let white = 0;
  for (let x = 0; x < W; x++) if (row[x * stride]! > 220) white++;
  return white;
};
const previewRow = (y: number) => page.evaluate((r) => (globalThis as PageGlobal).__rezzoPreview?.readRow(r) ?? [], y);

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-e2e-'));
  const video = await makeNumberedVideo(path.join(dir, 'numbered.mp4'), { seconds: PICTURE, soundLonger: 0.1 });
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
  // The source is as long as its sound.
  expect(project.source!.duration).toBeGreaterThan(PICTURE + 0.05);
  const end = Math.floor(project.source!.duration * 30) / 30;
  frames = Math.round((end - START) * 30);
  project.transcript = {
    language: 'sr',
    model: 'test',
    createdAt: new Date().toISOString(),
    startShift: -0.1,
    segments: [{ start: 2.1, end: 2.5, words: [{ text: 'Kraj.', start: 2.1, end: 2.5, p: 0.9 }] }],
  };
  const video0 = defaultVideoLayer(START);
  video0.layout = [{ t: START, value: 'full', ease: 'cut' }];
  const text: TextLayer = {
    id: crypto.randomUUID(), kind: 'text', text: 'Kraj', style: DEFAULT_TEXT_STYLE, start: PICTURE, end,
    transform: [{ t: PICTURE, value: { x: 0.5, y: 0.4, scale: 1, rotation: 0, opacity: 1 }, ease: 'cut' }], motion: NO_MOTION,
  };
  project.clips = [{ id: crypto.randomUUID(), name: 'Kraj', start: START, end, skips: [], evenLoudness: false, layers: [video0, text] }];
  await writeFile(file, JSON.stringify(project));
  await page.getByRole('button', { name: /numbered/ }).click();
  await page.locator('.clip-list li', { hasText: 'Kraj' }).getByRole('button', { name: 'Kraj' }).click();
  await until(async () => (await previewRow(0)).length > 0, 20_000);
  await analysisDone(page);
});

afterAll(async () => {
  await stopApp(app);
  await rm(dir, { recursive: true, force: true });
});

describe('a picture shorter than its sound', () => {
  it('holds the last picture in the paused preview, with the layers over it', async () => {
    // Two seconds on: the first frame past the picture.
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => numberOf(await previewRow(NUMBER_ROW), 4), { timeout: 10_000 }).toBe(LAST_FRAME);
    await expect.poll(async () => whiteIn(await previewRow(TEXT_ROW), 4), { timeout: 10_000 }).toBeGreaterThan(20);
    // And a frame further, which only redraws what's over it.
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => numberOf(await previewRow(NUMBER_ROW), 4)).toBe(LAST_FRAME);
  });

  it('exports every frame, the last picture held under the text', async () => {
    const out = path.join(dir, 'out', 'kraj.mp4');
    await answerSaveDialog(app!, out);
    await page.locator('.clip-editor header').getByRole('button', { name: 'Export' }).click();
    await page.getByRole('heading', { name: 'Clip exported' }).waitFor({ timeout: 60_000 });

    const { stdout } = await run(ffmpegExe(), ['-v', 'error', '-i', out, '-map', '0:v', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 30 });
    expect(stdout.length / (W * H)).toBe(frames);
    const row = (i: number, y: number) => stdout.subarray(i * W * H + y * W, i * W * H + (y + 1) * W);
    const picture = (PICTURE - START) * 30;
    // The picture's last frame, without the text; then the same picture with it, to the end.
    expect(numberOf(row(picture - 1, NUMBER_ROW), 1)).toBe(LAST_FRAME);
    expect(whiteIn(row(picture - 1, TEXT_ROW), 1)).toBe(0);
    for (let i = picture; i < frames; i++) {
      expect(numberOf(row(i, NUMBER_ROW), 1)).toBe(LAST_FRAME);
      expect(whiteIn(row(i, TEXT_ROW), 1)).toBeGreaterThan(20);
    }
  });
});
