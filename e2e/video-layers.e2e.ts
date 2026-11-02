/**
 * Video layers: a transparent WebM (VP9 with alpha) and a green-screen
 * video over the clip, drawn where and when the scene says, with their own
 * offset and loop, in the preview and in the export. The files are made
 * here by FFmpeg:
 * - "alpha": 640×360, 2 s; the left half is blue for the first second and
 *   yellow for the second, the right half is transparent;
 * - "green": 640×360, 2 s, green with a red 200×200 square in the middle.
 * The project is written by the test, since the Add menu doesn't offer
 * video yet.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { VideoAsset } from '../src/shared/assets.ts';
import { DEFAULT_CHROMA_KEY } from '../src/shared/chroma-key.ts';
import { defaultVideoLayer } from '../src/shared/framing.ts';
import { DEFAULT_MOTION } from '../src/shared/motion.ts';
import type { OverlayLayer, Project } from '../src/shared/project.ts';
import { fingerprint } from '../src/workers/media/fingerprint.ts';
import { answerOpenDialog, answerSaveDialog, ffmpegExe, launchApp, makeNumberedVideo, stopApp } from './helpers.ts';

const run = promisify(execFile);

/** `window` inside page.evaluate(); this config has no DOM types. */
type PageGlobal = typeof globalThis & { __rezzoPreview?: { readRow(y: number): number[] } };

const W = 1080;
const H = 1920;
/** The clip: 2 s to 6 s of the source. */
const START = 2;
const END = 6;

/**
 * "alpha" from 3 s to 5 s, half the output wide (540×304) in the middle:
 * x 270 to 810, y 808 to 1112; its opaque half ends at x = 540. It starts
 * half a second into its file and loops.
 */
const ALPHA_ROW = 960;
const ALPHA_X = 400;
const CLEAR_X = 700;
/** "green" over the whole clip, half wide, centred at y = 480: its red square spans x 456 to 624. */
const GREEN_ROW = 480;
const SQUARE_X = 540;
const KEYED_X = 330;

let dir: string;
let app: ElectronApplication | undefined;
let page: Page;

async function until(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function pixel(x: number, y: number): Promise<[number, number, number]> {
  const row = await page.evaluate((r) => (globalThis as PageGlobal).__rezzoPreview?.readRow(r) ?? [], y);
  return [row[x * 4] ?? -1, row[x * 4 + 1] ?? -1, row[x * 4 + 2] ?? -1];
}

const isBlue = ([r, g, b]: number[]) => b! > 200 && r! < 60 && g! < 60;
const isYellow = ([r, g, b]: number[]) => r! > 200 && g! > 200 && b! < 60;
const isRed = ([r, g, b]: number[]) => r! > 200 && g! < 60 && b! < 60;
const isGrey = ([r, g, b]: number[]) => [r, g, b].every((v) => Math.abs(v! - 130) < 14);

/** Moves the playhead to `t` seconds into the source: back to the clip's start a second at a time, then on by frames. */
async function goTo(t: number): Promise<void> {
  for (let i = 0; i < END - START + 1; i++) await page.keyboard.press('Shift+ArrowLeft');
  const frames = Math.round((t - START) * 30);
  for (let i = 0; i < frames; i++) await page.keyboard.press('ArrowRight');
}

function overlay(asset: VideoAsset, patch: Partial<OverlayLayer>): OverlayLayer {
  const start = patch.start ?? START;
  return {
    id: crypto.randomUUID(),
    kind: 'overlay',
    assetId: asset.id,
    start,
    end: END,
    transform: [{ t: start, value: { x: 0.5, y: 0.5, scale: 0.5, rotation: 0, opacity: 1 }, ease: 'cut' }],
    motion: { ...DEFAULT_MOTION, in: { ...DEFAULT_MOTION.in, kind: 'none' }, out: { ...DEFAULT_MOTION.out, kind: 'none' } },
    key: null,
    offset: 0,
    volume: 1,
    loop: false,
    ...patch,
  };
}

async function videoAsset(file: string, alpha: boolean, codec: string): Promise<VideoAsset> {
  return {
    id: crypto.randomUUID(),
    kind: 'video',
    path: file,
    name: path.basename(file),
    size: (await stat(file)).size,
    fingerprint: await fingerprint(file),
    codec,
    width: 640,
    height: 360,
    duration: 2,
    frameRate: [30, 1],
    colorSpace: null,
    alpha,
    hasAudio: false,
  };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-e2e-'));
  const video = await makeNumberedVideo(path.join(dir, 'numbered.mp4'), { seconds: 10 });
  const alphaFile = path.join(dir, 'alpha.webm');
  await run(ffmpegExe(), [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=30:d=1',
    '-f', 'lavfi', '-i', 'color=c=yellow:s=640x360:r=30:d=1',
    '-filter_complex', "[0:v][1:v]concat=n=2:v=1,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(X,320),255,0)'",
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-crf', '20', '-b:v', '0', alphaFile,
  ]);
  const greenFile = path.join(dir, 'green.mp4');
  await run(ffmpegExe(), [
    '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x00ff00:s=640x360:r=30:d=2',
    '-vf', 'drawbox=x=220:y=80:w=200:h=200:color=red:t=fill', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '12', greenFile,
  ]);

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
    segments: [{ start: 2.1, end: 2.5, words: [{ text: 'Video.', start: 2.1, end: 2.5, p: 0.9 }] }],
  };
  const alpha = await videoAsset(alphaFile, true, 'vp9');
  const green = await videoAsset(greenFile, false, 'h264');
  project.assets = [alpha, green];
  project.clips = [{
    id: crypto.randomUUID(),
    name: 'Video',
    start: START,
    end: END,
    layers: [
      defaultVideoLayer(START),
      overlay(alpha, { start: 3, end: 5, offset: 0.5, loop: true }),
      overlay(green, { key: { ...DEFAULT_CHROMA_KEY }, transform: [{ t: START, value: { x: 0.5, y: 0.25, scale: 0.5, rotation: 0, opacity: 1 }, ease: 'cut' }] }),
    ],
  }];
  await writeFile(file, JSON.stringify(project));
  await page.getByRole('button', { name: /numbered/ }).click();
  await page.locator('.clip-list li', { hasText: 'Video' }).getByRole('button', { name: 'Video' }).click();
  // The video layers' files are made in the background; the keyed square shows once "green" is drawn.
  await until(async () => isRed(await pixel(SQUARE_X, GREEN_ROW)), 30_000);
});

afterAll(async () => {
  await stopApp(app);
  await rm(dir, { recursive: true, force: true });
});

describe('video layers', () => {
  it('keys out the green screen, showing the video below', async () => {
    expect(isRed(await pixel(SQUARE_X, GREEN_ROW))).toBe(true);
    expect(isGrey(await pixel(KEYED_X, GREEN_ROW))).toBe(true);
  });

  it('draws a transparent video only in its own time, the video showing through its clear half', async () => {
    await goTo(2.5);
    await expect.poll(async () => isGrey(await pixel(ALPHA_X, ALPHA_ROW))).toBe(true);
    // 3.2 s: 0.2 s into the layer, 0.7 s into the file: blue.
    await goTo(3.2);
    await expect.poll(async () => isBlue(await pixel(ALPHA_X, ALPHA_ROW)), { timeout: 10_000 }).toBe(true);
    expect(isGrey(await pixel(CLEAR_X, ALPHA_ROW))).toBe(true);
    // No line along its edges from the padding or the alpha half of the stacked file.
    for (const y of [806, 810, 1108, 1114]) expect(isGrey(await pixel(CLEAR_X, y)), `row ${y}`).toBe(true);
    expect(isBlue(await pixel(ALPHA_X, 1108))).toBe(true);
  });

  it('starts the file at its offset and loops it', async () => {
    // 3.7 s: 1.2 s into the file, its yellow second.
    await goTo(3.7);
    await expect.poll(async () => isYellow(await pixel(ALPHA_X, ALPHA_ROW)), { timeout: 10_000 }).toBe(true);
    // 4.8 s: 2.3 s into a 2 s file, so 0.3 s into it again: blue.
    await goTo(4.8);
    await expect.poll(async () => isBlue(await pixel(ALPHA_X, ALPHA_ROW)), { timeout: 10_000 }).toBe(true);
  });

  it('plays the layers along with the clip', async () => {
    await goTo(3);
    await page.keyboard.press('Space');
    await expect.poll(async () => isYellow(await pixel(ALPHA_X, ALPHA_ROW)), { timeout: 10_000 }).toBe(true);
    await page.keyboard.press('Space');
  });

  it('exports the layers as the preview draws them', async () => {
    const out = path.join(dir, 'video.mp4');
    await answerSaveDialog(app!, out);
    await page.locator('.clip-editor header').getByRole('button', { name: 'Export' }).click();
    await page.getByRole('heading', { name: 'Clip exported' }).waitFor({ timeout: 60_000 });
    await page.locator('.export-dialog').getByRole('button', { name: 'Close', exact: true }).click();

    const { stdout } = await run(ffmpegExe(), ['-v', 'error', '-i', out, '-map', '0:v', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1'], {
      encoding: 'buffer',
      maxBuffer: 1 << 30,
    });
    const size = W * H * 1.5;
    expect(stdout.length / size).toBe((END - START) * 30);
    const cb = (i: number, x: number, y: number) => stdout[i * size + W * H + (y >> 1) * (W / 2) + (x >> 1)]!;
    const cr = (i: number, x: number, y: number) => stdout[i * size + W * H + (W / 2) * (H / 2) + (y >> 1) * (W / 2) + (x >> 1)]!;
    const frame = (t: number) => Math.round((t - START) * 30);
    const grey = (i: number, x: number, y: number) => Math.abs(cb(i, x, y) - 128) < 8 && Math.abs(cr(i, x, y) - 128) < 8;

    expect(grey(frame(2.5), ALPHA_X, ALPHA_ROW)).toBe(true);
    // Blue: Cb high. Yellow: Cb low.
    expect(cb(frame(3.2), ALPHA_X, ALPHA_ROW)).toBeGreaterThan(200);
    expect(grey(frame(3.2), CLEAR_X, ALPHA_ROW)).toBe(true);
    expect(cb(frame(3.7), ALPHA_X, ALPHA_ROW)).toBeLessThan(60);
    expect(cb(frame(4.8), ALPHA_X, ALPHA_ROW)).toBeGreaterThan(200);
    // The keyed layer: red square kept, green gone.
    expect(cr(frame(2.5), SQUARE_X, GREEN_ROW)).toBeGreaterThan(200);
    expect(grey(frame(2.5), KEYED_X, GREEN_ROW)).toBe(true);
  });
});
