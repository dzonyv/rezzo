/**
 * Lottie animations and effects: an animation drawn at the frame the clip
 * is at, with its transparency, in the preview and the export; effects
 * changing what's under them. The animation is written here: a red bar
 * that moves from the left half to the right half over 60 frames, over a
 * white strip at half opacity.
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultVideoLayer } from '../src/shared/framing.ts';
import { PROJECT_FORMAT, type Project } from '../src/shared/project.ts';
import { analysisDone, answerOpenDialog, answerSaveDialog, ffmpegExe, launchApp, makeNumberedVideo, stopApp } from './helpers.ts';
import { zip } from './zip.ts';

const run = promisify(execFile);

/** `window` inside page.evaluate(); this config has no DOM types. */
type PageGlobal = typeof globalThis & { __rezzoPreview?: { readRow(y: number): number[] } };

const W = 1080;
const H = 1920;
/** The clip: 2 s to 6 s of the source, 30 fps. */
const START = 2;
const END = 6;

/**
 * A 200×200 animation, 60 frames at 30 fps: a red bar 100 wide and 150
 * tall moving from x 0..100 (frame 0) to 100..200 (frame 59), and a white
 * strip at half opacity along the bottom 40 rows.
 */
const ANIMATION = {
  v: '5.7.4', fr: 30, ip: 0, op: 60, w: 200, h: 200, nm: 'bar', ddd: 0, assets: [],
  layers: [
    shapeLayer(1, 'bar', 100, [100, 150], [1, 0, 0, 1], { a: 1, k: [{ t: 0, s: [50, 75, 0], i: { x: [1], y: [1] }, o: { x: [0], y: [0] } }, { t: 59, s: [150, 75, 0] }] }),
    shapeLayer(2, 'strip', 50, [200, 40], [1, 1, 1, 1], { a: 0, k: [100, 180, 0] }),
  ],
};

function shapeLayer(ind: number, nm: string, opacity: number, size: number[], color: number[], position: object) {
  const still = (k: unknown) => ({ a: 0, k });
  return {
    ddd: 0, ind, ty: 4, nm, sr: 1, ao: 0, ip: 0, op: 60, st: 0, bm: 0,
    ks: { o: still(opacity), r: still(0), p: position, a: still([0, 0, 0]), s: still([100, 100, 100]) },
    shapes: [{
      ty: 'gr', nm: 'g',
      it: [
        { ty: 'rc', nm: 'r', d: 1, s: still(size), p: still([0, 0]), r: still(0) },
        { ty: 'fl', nm: 'f', c: still(color), o: still(100), r: 1 },
        { ty: 'tr', p: still([0, 0]), a: still([0, 0]), s: still([100, 100]), r: still(0), o: still(100) },
      ],
    }],
  };
}

/**
 * A new animation is centred and 0.6 of the output wide: 648×648, from
 * x = 216 to 864 and y = 636 to 1284, 3.24 output pixels per animation
 * pixel. The bar's rows are y 636..1122, the strip's 1154..1284.
 */
const BAR_ROW = 900;
const STRIP_ROW = 1220;
const LEFT_X = 300;
const RIGHT_X = 700;
const OUTSIDE_X = 100;

let dir: string;
let app: ElectronApplication | undefined;
let page: Page;
let file: string;
let animation: string;

/** expect.poll() for hooks, where vitest doesn't allow it. */
async function until(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** The preview's RGB at (x, y). */
async function pixel(x: number, y = BAR_ROW): Promise<[number, number, number]> {
  const row = await page.evaluate((r) => (globalThis as PageGlobal).__rezzoPreview?.readRow(r) ?? [], y);
  return [row[x * 4] ?? -1, row[x * 4 + 1] ?? -1, row[x * 4 + 2] ?? -1];
}

const isRed = ([r, g, b]: number[]) => r! > 200 && g! < 60 && b! < 60;
/** The numbered video's grey background. */
const isGrey = ([r, g, b]: number[]) => [r, g, b].every((v) => Math.abs(v! - 130) < 12);

/** Moves the playhead by `frames` frames (negative: back). */
async function step(frames: number): Promise<void> {
  for (let i = 0; i < Math.abs(frames); i++) await page.keyboard.press(frames > 0 ? 'ArrowRight' : 'ArrowLeft');
}

async function saved(): Promise<Project> {
  await page.keyboard.press('Control+S');
  await expect.poll(() => page.locator('.topbar .dirty').count()).toBe(0);
  return JSON.parse(await readFile(file, 'utf8')) as Project;
}

async function addEffect(name: string): Promise<void> {
  await page.locator('.add-menu summary').click();
  await page.locator('.add-menu').getByRole('button', { name: /^Effect/ }).click();
  await page.locator('.effect-library').getByRole('button', { name, exact: true }).click();
  await page.getByRole('heading', { name: `Effect: ${name}` }).waitFor();
}

/** Exports the clip and returns its frames as yuv420p. */
async function exportFrames(name: string): Promise<Buffer> {
  const out = path.join(dir, 'out', name);
  await answerSaveDialog(app!, out);
  await page.locator('.clip-editor header').getByRole('button', { name: 'Export' }).click();
  await page.getByRole('heading', { name: 'Clip exported' }).waitFor({ timeout: 60_000 });
  await page.locator('.export-dialog').getByRole('button', { name: 'Close', exact: true }).click();
  const { stdout } = await run(ffmpegExe(), ['-v', 'error', '-i', out, '-map', '0:v', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1'], {
    encoding: 'buffer',
    maxBuffer: 1 << 30,
  });
  expect(stdout.length / (W * H * 1.5)).toBe((END - START) * 30);
  return stdout;
}

const FRAME = W * H * 1.5;
/** Luma (16 black .. 235 white) at (x, y) of frame `i`. */
const lumaAt = (frames: Buffer, i: number, x: number, y: number) => frames[i * FRAME + y * W + x]!;
/** Cr (red-difference) at (x, y) of frame `i`: far above 128 for red, about 128 for grey. */
const crAt = (frames: Buffer, i: number, x: number, y: number) => frames[i * FRAME + W * H + (W / 2) * (H / 2) + Math.floor(y / 2) * (W / 2) + Math.floor(x / 2)]!;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-e2e-'));
  const video = await makeNumberedVideo(path.join(dir, 'numbered.mp4'), { seconds: 10 });
  animation = path.join(dir, 'bar.json');
  await writeFile(animation, JSON.stringify(ANIMATION));
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
    segments: [{ start: 2.1, end: 2.5, words: [{ text: 'Efekti.', start: 2.1, end: 2.5, p: 0.9 }] }],
  };
  project.clips = [{ id: crypto.randomUUID(), name: 'Efekti', start: START, end: END, layers: [defaultVideoLayer(START)] }];
  await writeFile(file, JSON.stringify(project));
  await page.getByRole('button', { name: /numbered/ }).click();
  await page.locator('.clip-list li', { hasText: 'Efekti' }).getByRole('button', { name: 'Efekti' }).click();
  await analysisDone(page);
  await until(async () => isGrey(await pixel(OUTSIDE_X)), 20_000);
});

afterAll(async () => {
  await stopApp(app);
  await rm(dir, { recursive: true, force: true });
});

describe('Lottie layers', () => {
  it('adds an animation and draws the frame the clip is at, with its transparency', async () => {
    await answerOpenDialog(app!, animation);
    await page.locator('.add-menu summary').click();
    await page.locator('.add-menu').getByRole('button', { name: 'Animation' }).click();
    await page.getByRole('heading', { name: 'Animation: bar.json' }).waitFor();

    // Frame 0: the bar is on the left half; the rest of the animation is clear.
    await expect.poll(async () => isRed(await pixel(LEFT_X)), { timeout: 10_000 }).toBe(true);
    expect(isGrey(await pixel(RIGHT_X))).toBe(true);
    expect(isGrey(await pixel(OUTSIDE_X))).toBe(true);
    // White at half opacity over grey (130): about 192, if the animation's alpha is handled right.
    const [r, g, b] = await pixel(LEFT_X, STRIP_ROW);
    for (const v of [r, g, b]) expect(Math.abs(v - 192)).toBeLessThan(8);

    // Frame 59: the bar has moved to the right half.
    await step(59);
    await expect.poll(async () => isRed(await pixel(RIGHT_X)), { timeout: 10_000 }).toBe(true);
    expect(isGrey(await pixel(LEFT_X))).toBe(true);
  });

  it('keeps the animation in the saved project', async () => {
    const project = await saved();
    expect(project.format).toBe(PROJECT_FORMAT);
    expect(project.assets).toMatchObject([{ kind: 'lottie', name: 'bar.json', width: 200, height: 200, frameRate: 30, frames: 60 }]);
    expect(project.clips[0]!.layers.map((l) => l.kind)).toEqual(['video', 'lottie']);
  });

  it('exports the animation as the preview draws it', async () => {
    const frames = await exportFrames('lottie.mp4');
    expect(crAt(frames, 0, LEFT_X, BAR_ROW)).toBeGreaterThan(200);
    expect(Math.abs(crAt(frames, 0, RIGHT_X, BAR_ROW) - 128)).toBeLessThan(6);
    expect(crAt(frames, 59, RIGHT_X, BAR_ROW)).toBeGreaterThan(200);
    expect(Math.abs(crAt(frames, 59, LEFT_X, BAR_ROW) - 128)).toBeLessThan(6);
  });

  it('refuses an animation that needs image files kept beside it', async () => {
    const withImages = path.join(dir, 'images.json');
    await writeFile(withImages, JSON.stringify({ ...ANIMATION, assets: [{ id: 'img_0', w: 10, h: 10, u: 'images/', p: 'img_0.png', e: 0 }] }));
    await answerOpenDialog(app!, withImages);
    await page.locator('.add-menu summary').click();
    await page.locator('.add-menu').getByRole('button', { name: 'Animation' }).click();
    await page.getByText('That animation shows image files kept next to it.', { exact: false }).waitFor();
    expect(await page.locator('.clip-timeline .layer-bar').count()).toBe(1);
  });

  it('plays a .lottie package in place of the JSON', async () => {
    const packaged = path.join(dir, 'bar.lottie');
    await writeFile(packaged, zip({ 'manifest.json': JSON.stringify({ version: '1', animations: [{ id: 'bar' }] }), 'animations/bar.json': JSON.stringify(ANIMATION) }));
    await answerOpenDialog(app!, packaged);
    await page.getByRole('button', { name: 'Change animation…' }).click();
    await page.getByRole('heading', { name: 'Animation: bar.lottie' }).waitFor();
    // Still at frame 59: the bar on the right.
    await expect.poll(async () => isRed(await pixel(RIGHT_X)), { timeout: 10_000 }).toBe(true);
    expect(isGrey(await pixel(LEFT_X))).toBe(true);
  });
});

describe('effects', () => {
  it('turns what is under it black and white, but not the layers above it', async () => {
    // Back to the clip's first frame, where the bar is red on the left.
    await page.keyboard.press('Escape');
    await step(-59);
    await expect.poll(async () => isRed(await pixel(LEFT_X)), { timeout: 10_000 }).toBe(true);
    await addEffect('Black and white');
    await expect.poll(async () => {
      const [r, g, b] = await pixel(LEFT_X);
      return Math.abs(r - g) < 6 && Math.abs(g - b) < 6 && r < 100;
    }, { timeout: 10_000 }).toBe(true);

    // Moved below the animation, it leaves the animation red.
    await page.locator('.timeline-label').filter({ hasText: 'Black and white' }).getByRole('button', { name: 'Send backward' }).click();
    await expect.poll(async () => isRed(await pixel(LEFT_X)), { timeout: 10_000 }).toBe(true);
    await page.locator('.timeline-label').filter({ hasText: 'Black and white' }).getByRole('button', { name: 'Bring forward' }).click();
  });

  it('flashes white at the start of a flash and fades to black at the end of a fade', async () => {
    await page.keyboard.press('Escape');
    // To 5 s: three seconds in.
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
    await addEffect('Fade to black');
    await page.keyboard.press('Escape');
    await addEffect('White flash');
    await expect.poll(async () => (await pixel(OUTSIDE_X)).every((v) => v > 245), { timeout: 10_000 }).toBe(true);

    // The clip's last frame: the fade is all but done.
    await page.keyboard.press('Escape');
    await step(29);
    await expect.poll(async () => (await pixel(OUTSIDE_X)).every((v) => v < 8), { timeout: 10_000 }).toBe(true);
  });

  it('keeps the effects in the saved project', async () => {
    const project = await saved();
    const effects = project.clips[0]!.layers.flatMap((l) => (l.kind === 'effect' ? [l.effect] : []));
    expect(effects).toEqual(['blackWhite', 'fadeOut', 'flash']);
  });

  it('exports the effects as the preview draws them', async () => {
    const frames = await exportFrames('effects.mp4');
    // Black and white over the red bar: no colour left, and darker than the grey around it.
    expect(Math.abs(crAt(frames, 0, LEFT_X, BAR_ROW) - 128)).toBeLessThan(6);
    expect(lumaAt(frames, 0, LEFT_X, BAR_ROW)).toBeLessThan(100);
    // The flash's first frame is white; the fade's last is black.
    expect(lumaAt(frames, 90, OUTSIDE_X, BAR_ROW)).toBeGreaterThan(228);
    expect(lumaAt(frames, 119, OUTSIDE_X, BAR_ROW)).toBeLessThan(24);
  });
});
