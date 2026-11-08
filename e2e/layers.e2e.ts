/**
 * Layers over the picture: adding an image to a clip, where and when the
 * renderer draws it (transparent parts show the video), moving it in the
 * preview and on the timeline with undo, saving it in the project, finding
 * a file that moved, and exporting it. The image is made here by FFmpeg:
 * red on the left half, transparent on the right.
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultVideoLayer } from '../src/shared/framing.ts';
import type { ImageLayer, Project } from '../src/shared/project.ts';
import { analysisDone, answerOpenDialog, answerSaveDialog, ffmpegExe, launchApp, makeNumberedVideo, openTool, stopApp } from './helpers.ts';

const run = promisify(execFile);

/** `window` inside page.evaluate(); this config has no DOM types. */
type PageGlobal = typeof globalThis & { __rezzoPreview?: { readRow(y: number): number[] } };

const W = 1080;
const H = 1920;
/** The clip: 2 s to 6 s of the source. */
const START = 2;
const END = 6;
/**
 * A new image is centred and 0.6 of the output wide: 648×324 for this
 * 200×100 picture, from x = 216 to 864 and y = 798 to 1122. Its red half
 * ends at x = 540.
 */
const ROW = 960;
const RED_X = 300;
const CLEAR_X = 700;
const OUTSIDE_X = 100;

let dir: string;
let app: ElectronApplication | undefined;
let page: Page;
let file: string;
let image: string;

/** expect.poll() for hooks, where vitest doesn't allow it. */
async function until(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** The preview's RGB at (x, ROW). */
async function pixel(x: number): Promise<[number, number, number]> {
  const row = await page.evaluate((y) => (globalThis as PageGlobal).__rezzoPreview?.readRow(y) ?? [], ROW);
  return [row[x * 4] ?? -1, row[x * 4 + 1] ?? -1, row[x * 4 + 2] ?? -1];
}

const isRed = ([r, g, b]: number[]) => r! > 200 && g! < 60 && b! < 60;
/** The numbered video's grey background. */
const isGrey = ([r, g, b]: number[]) => [r, g, b].every((v) => Math.abs(v! - 130) < 12);

/** Saves and reads the file back once the save has finished. */
async function saved(): Promise<Project> {
  await page.keyboard.press('Control+S');
  await expect.poll(() => page.locator('.topbar .dirty').count()).toBe(0);
  return JSON.parse(await readFile(file, 'utf8')) as Project;
}

const imageLayers = (p: Project) => p.clips[0]!.layers.filter((l): l is ImageLayer => l.kind === 'image');

async function openClip(): Promise<void> {
  await page.locator('.clip-list li', { hasText: 'Slike' }).getByRole('button', { name: 'Slike' }).click();
  // The preview has drawn the clip's first frame.
  await until(async () => isGrey(await pixel(OUTSIDE_X)), 20_000);
  await analysisDone(page);
}

async function reopenProject(): Promise<void> {
  await page.getByRole('button', { name: 'Close project' }).click();
  await page.getByRole('button', { name: /numbered/ }).click();
  await openClip();
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-e2e-'));
  const video = await makeNumberedVideo(path.join(dir, 'numbered.mp4'), { seconds: 10 });
  image = path.join(dir, 'red.png');
  await run(ffmpegExe(), [
    '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=200x100',
    '-vf', "format=rgba,geq=r=255:g=0:b=0:a='if(lt(X,100),255,0)'", '-frames:v', '1', image,
  ]);
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
  // The clip list shows once there's a transcript.
  project.transcript = {
    language: 'sr',
    model: 'test',
    createdAt: new Date().toISOString(),
    startShift: -0.1,
    segments: [{ start: 2.1, end: 2.5, words: [{ text: 'Slike.', start: 2.1, end: 2.5, p: 0.9 }] }],
  };
  project.clips =[{ id: crypto.randomUUID(), name: 'Slike', start: START, end: END, skips: [], evenLoudness: false, layers: [defaultVideoLayer(START)] }];
  await writeFile(file, JSON.stringify(project));
  await page.getByRole('button', { name: /numbered/ }).click();
  await openClip();
});

afterAll(async () => {
  await stopApp(app);
  await rm(dir, { recursive: true, force: true });
});

describe('image layers', () => {
  it('adds an image from the playhead on, drawn over the picture with its transparency', async () => {
    // One second in: the image starts there.
    await page.keyboard.press('Shift+ArrowRight');
    await answerOpenDialog(app!, image);
    await openTool(page, 'Layers');
    await page.locator('.add-tiles').getByRole('button', { name: 'Image' }).click();
    await page.getByRole('heading', { name: 'Image: red.png' }).waitFor();
    expect(await page.locator('.clip-timeline .layer-bar').count()).toBe(1);

    // It pops in over 0.3 s; ten frames later it's all there.
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
    await expect.poll(async () => isRed(await pixel(RED_X)), { timeout: 10_000 }).toBe(true);
    expect(isGrey(await pixel(CLEAR_X))).toBe(true);
    expect(isGrey(await pixel(OUTSIDE_X))).toBe(true);

    const project = await saved();
    expect(project.assets).toMatchObject([{ kind: 'image', name: 'red.png', width: 200, height: 100 }]);
    const [layer] = imageLayers(project);
    expect(layer!.start).toBeCloseTo(START + 1, 5);
    expect(layer!.end).toBeCloseTo(START + 4, 5);
  });

  it('shows nothing before the image starts', async () => {
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(async () => isGrey(await pixel(RED_X))).toBe(true);
    for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowRight');
    await expect.poll(async () => isRed(await pixel(RED_X))).toBe(true);
  });

  it('moves the image by dragging it in the preview, as one undo step', async () => {
    const box = (await page.locator('.layer-box').boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const preview = (await page.locator('.clip-preview').boundingBox())!;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    // Down by a quarter of the output, without snapping back to the middle.
    await page.keyboard.down('Shift');
    await page.mouse.move(cx, cy + preview.height / 4, { steps: 8 });
    await page.keyboard.up('Shift');
    await page.mouse.up();

    await expect.poll(async () => isGrey(await pixel(RED_X))).toBe(true);
    let [layer] = imageLayers(await saved());
    expect(layer!.transform).toHaveLength(1);
    expect(layer!.transform[0]!.value.y).toBeCloseTo(0.75, 1);
    expect(await page.getByRole('button', { name: 'Undo' }).getAttribute('title')).toBe('Undo: move layer');

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(async () => isRed(await pixel(RED_X))).toBe(true);
    [layer] = imageLayers(await saved());
    expect(layer!.transform[0]!.value.y).toBe(0.5);
  });

  it('moves the image in time by dragging it on the timeline', async () => {
    const bar = (await page.locator('.clip-timeline .layer-bar').boundingBox())!;
    const track = (await page.locator('.clip-timeline').boundingBox())!;
    const y = bar.y + bar.height / 2;
    await page.mouse.move(bar.x + bar.width / 2, y);
    await page.mouse.down();
    // A quarter of the 4 s clip earlier: it would start at the clip's start.
    await page.mouse.move(bar.x + bar.width / 2 - track.width / 4, y, { steps: 8 });
    await page.mouse.up();
    const [layer] = imageLayers(await saved());
    expect(layer!.start).toBeCloseTo(START, 5);
    expect(layer!.end).toBeCloseTo(START + 3, 5);
    expect(await page.getByRole('button', { name: 'Undo' }).getAttribute('title')).toBe('Undo: move layer in time');
  });

  it('keeps the image in the saved project', async () => {
    await reopenProject();
    expect(await page.locator('.clip-timeline .layer-bar').count()).toBe(1);
    // The playhead is at the clip's start, past the pop-in only after ten frames.
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
    await expect.poll(async () => isRed(await pixel(RED_X)), { timeout: 10_000 }).toBe(true);
  });

  it('finds the image again after it moved', async () => {
    const moved = path.join(dir, 'moved.png');
    await rename(image, moved);
    await reopenProject();
    await page.locator('.clip-timeline .layer-bar', { hasText: 'red.png' }).click();
    await page.getByText("red.png isn't at", { exact: false }).waitFor();
    await answerOpenDialog(app!, moved);
    await page.getByRole('button', { name: 'Find it…' }).click();
    await expect.poll(() => page.getByText("red.png isn't at", { exact: false }).count()).toBe(0);
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
    await expect.poll(async () => isRed(await pixel(RED_X)), { timeout: 10_000 }).toBe(true);
    expect((await saved()).assets[0]!.path).toBe(moved);
  });

  it('exports the image as the preview draws it', async () => {
    const out = path.join(dir, 'out', 'slike.mp4');
    await answerSaveDialog(app!, out);
    await page.locator('.clip-editor header').getByRole('button', { name: 'Export' }).click();
    await page.getByRole('heading', { name: 'Clip exported' }).waitFor({ timeout: 60_000 });
    await page.locator('.export-dialog').getByRole('button', { name: 'Close', exact: true }).click();

    const { stdout } = await run(ffmpegExe(), ['-v', 'error', '-i', out, '-map', '0:v', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1'], {
      encoding: 'buffer',
      maxBuffer: 1 << 30,
    });
    const size = W * H * 1.5;
    const frames = stdout.length / size;
    expect(frames).toBe((END - START) * 30);
    /** Cr (red-difference) at (x, ROW) of frame `i`: far above 128 for red, about 128 for grey. */
    const cr = (i: number, x: number) => stdout[i * size + W * H + (W / 2) * (H / 2) + (ROW / 2) * (W / 2) + x / 2]!;
    // Popping in on the first frame: not there yet. Fully in after 0.3 s; gone after 3 s.
    expect(Math.abs(cr(0, RED_X) - 128)).toBeLessThan(6);
    expect(cr(15, RED_X)).toBeGreaterThan(200);
    expect(Math.abs(cr(15, CLEAR_X) - 128)).toBeLessThan(6);
    expect(Math.abs(cr(95, RED_X) - 128)).toBeLessThan(6);
  });
});
