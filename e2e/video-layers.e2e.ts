/**
 * Video layers: a transparent WebM (VP9 with alpha) and a green-screen
 * video over the clip, drawn where and when the scene says, with their own
 * offset and loop, in the preview and in the export. The files are made
 * here by FFmpeg:
 * - "alpha": 640×360, 2 s; the left half is blue for the first second and
 *   yellow for the second, the right half is transparent;
 * - "green": 640×360, 2 s, green with a red 200×200 square in the middle;
 * - "beep": 640×360, 1 s, black, with a 3 kHz beep from 0.5 s to 0.7 s.
 * The project is written by the test, so the drawing is checked apart
 * from the editing; the last tests add and edit a video layer through the
 * editor.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
let file: string;
let greenFile: string;

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

async function videoAsset(file: string, alpha: boolean, codec: string, { duration = 2, hasAudio = false } = {}): Promise<VideoAsset> {
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
    duration,
    frameRate: [30, 1],
    colorSpace: null,
    alpha,
    hasAudio,
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
  greenFile = path.join(dir, 'green.mp4');
  await run(ffmpegExe(), [
    '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x00ff00:s=640x360:r=30:d=2',
    '-vf', 'drawbox=x=220:y=80:w=200:h=200:color=red:t=fill', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '12', greenFile,
  ]);
  const beepFile = path.join(dir, 'beep.mp4');
  await run(ffmpegExe(), [
    '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=30:d=1',
    '-f', 'lavfi', '-i', 'sine=frequency=3000:sample_rate=48000:duration=0.2',
    '-af', 'adelay=500:all=1,apad=whole_dur=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '1', beepFile,
  ]);

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
    segments: [{ start: 2.1, end: 2.5, words: [{ text: 'Video.', start: 2.1, end: 2.5, p: 0.9 }] }],
  };
  const alpha = await videoAsset(alphaFile, true, 'vp9');
  const green = await videoAsset(greenFile, false, 'h264');
  const beep = await videoAsset(beepFile, false, 'h264', { duration: 1, hasAudio: true });
  project.assets = [alpha, green, beep];
  project.clips = [{
    id: crypto.randomUUID(),
    name: 'Video',
    skips: [],
    evenLoudness: false,
    start: START,
    end: END,
    layers: [
      defaultVideoLayer(START),
      overlay(alpha, { start: 3, end: 5, offset: 0.5, loop: true }),
      overlay(green, { key: { ...DEFAULT_CHROMA_KEY }, transform: [{ t: START, value: { x: 0.5, y: 0.25, scale: 0.5, rotation: 0, opacity: 1 }, ease: 'cut' }] }),
      // Its beep plays at 4.5 s, 2.5 s into the clip. Small, in a corner the other checks don't look at.
      overlay(beep, { start: 4, end: 5, transform: [{ t: 4, value: { x: 0.9, y: 0.95, scale: 0.1, rotation: 0, opacity: 1 }, ease: 'cut' }] }),
    ],
  }];
  await writeFile(file, JSON.stringify(project));
  await page.getByRole('button', { name: /numbered/ }).click();
  await page.locator('.clip-list li', { hasText: 'Video' }).getByRole('button', { name: 'Video' }).click();
  await analysisDone(page);
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

    // The beep, kept apart from the source's 440 Hz tone by a high-pass filter: heard once, 2.5 s in.
    const { stderr } = await run(ffmpegExe(), ['-v', 'info', '-nostats', '-i', out, '-af', 'highpass=f=2000,highpass=f=2000,silencedetect=n=-40dB:d=0.05', '-f', 'null', '-']);
    // silencedetect also ends the last silence where the file ends.
    const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1])).filter((t) => t < END - START - 0.1);
    const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
    expect(ends).toHaveLength(1);
    expect(ends[0]).toBeCloseTo(2.5, 1);
    expect(starts[1]).toBeCloseTo(2.7, 1);
  });
});

describe('editing video layers', () => {
  const layers = async () => {
    await page.keyboard.press('Control+S');
    await expect.poll(() => page.locator('.topbar .dirty').count()).toBe(0);
    return (JSON.parse(await readFile(file, 'utf8')) as Project).clips[0]!.layers.filter((l): l is OverlayLayer => l.kind === 'overlay');
  };
  /** Where output pixel (x, y) is on screen. */
  const onScreen = async (x: number, y: number) => {
    // The inspector can push the preview out of view in the small test window.
    await page.locator('.clip-preview').scrollIntoViewIfNeeded();
    const box = (await page.locator('.clip-preview canvas').boundingBox())!;
    return { x: box.x + (x / W) * box.width, y: box.y + (y / H) * box.height };
  };

  it('adds a video from the playhead on, as long as the file', async () => {
    await goTo(2.5);
    await answerOpenDialog(app!, greenFile);
    await openTool(page, 'Layers');
    await page.locator('.add-tiles').getByRole('button', { name: 'Video' }).click();
    await page.getByRole('heading', { name: 'Video: green.mp4' }).waitFor();
    const added = (await layers()).at(-1)!;
    expect(added.start).toBeCloseTo(2.5, 5);
    expect(added.end).toBeCloseTo(4.5, 5);
    expect(added).toMatchObject({ offset: 0, volume: 1, loop: false, key: null });
    // The same file as the keyed layer: one asset for both.
    expect(new Set((await layers()).map((l) => l.assetId)).size).toBe(3);
  });

  it('refuses a fifth video at the same moment', async () => {
    await goTo(4.2);
    await answerOpenDialog(app!, greenFile);
    await openTool(page, 'Layers');
    await page.locator('.add-tiles').getByRole('button', { name: 'Video' }).click();
    await page.locator('.notice', { hasText: 'At most 4 videos' }).waitFor();
    expect(await layers()).toHaveLength(4);
  });

  it("changes where the video starts, whether it loops, and says it has no sound", async () => {
    // The video added above is still selected.
    await page.getByRole('heading', { name: 'Video: green.mp4' }).waitFor();
    await page.getByText('This video has no sound.').waitFor();
    await page.getByRole('slider', { name: 'Start in the video' }).fill('1');
    await page.getByRole('checkbox', { name: 'Start over at the end' }).check();
    const added = (await layers()).at(-1)!;
    expect(added.offset).toBeCloseTo(1, 5);
    expect(added.loop).toBe(true);
  });

  it('turns on a green screen and picks its colour from the layer in the preview', async () => {
    await goTo(3);
    await page.getByRole('checkbox', { name: 'Green screen' }).check();
    expect((await layers()).at(-1)!.key).toMatchObject({ color: '#00ff00' });
    // The new layer is on top; its red square is drawn once its working file is decoded.
    await expect.poll(async () => isRed(await pixel(540, 960)), { timeout: 15_000 }).toBe(true);
    // The new layer is 648 wide in the middle; its file's red square is at x 439 to 641 there.
    await page.getByRole('button', { name: 'Pick from the picture' }).click();
    const at = await onScreen(540, 960);
    await page.mouse.click(at.x, at.y);
    const color = (await layers()).at(-1)!.key!.color;
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(60);
    // Picking from the layer's own picture: the keyed layer above it doesn't change the answer.
    expect(await page.getByText('Click the colour to remove').count()).toBe(0);
  });

  it('converts a long video only for the part it plays, and only once a change of it settles', async () => {
    // Make room under the limit: the green video added above goes.
    await page.keyboard.press('Delete');
    const long = path.join(dir, 'long.mp4');
    await run(ffmpegExe(), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=200', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', long]);
    await goTo(START);
    await answerOpenDialog(app!, long);
    await openTool(page, 'Layers');
    await page.locator('.add-tiles').getByRole('button', { name: 'Video' }).click();
    await page.getByRole('heading', { name: 'Video: long.mp4' }).waitFor();

    // Quick changes of where it starts: only the last one is converted.
    const slider = page.getByRole('slider', { name: 'Start in the video' });
    for (const offset of ['20', '60', '100', '140']) await slider.fill(offset);
    // Saved, to read the file's fingerprint: its cache folder is named after it.
    await layers();
    const longAsset = (JSON.parse(await readFile(file, 'utf8')) as Project).assets.find((a) => a.name === 'long.mp4')!;
    const overlayDir = path.join(dir, 'local', 'cache', longAsset.fingerprint, 'overlay');
    const made = async () => (await readdir(overlayDir).catch(() => [] as string[])).filter((n) => !n.includes('.part'));
    // 140 s in, less the 2 s margin, at 30 fps: the file starts at frame 4140.
    await expect.poll(async () => (await made()).some((n) => n.startsWith('4140-')), { timeout: 30_000 }).toBe(true);
    const names = await made();
    for (const skipped of [540, 1740, 2940]) expect(names.some((n) => n.startsWith(`${skipped}-`)), `a file from frame ${skipped}`).toBe(false);
    // The one for its first place (from 0 s) may have finished before the changes came; nothing else.
    expect(names.length).toBeLessThanOrEqual(2);
  });
});
