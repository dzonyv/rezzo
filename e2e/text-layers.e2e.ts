/**
 * Text layers: adding one from the Layers drawer, the renderer drawing it
 * over the picture, typing into it as one undo step, saving it in the
 * project, and the export drawing it where the preview does.
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultVideoLayer } from '../src/shared/framing.ts';
import type { Project, TextLayer } from '../src/shared/project.ts';
import { analysisDone, answerOpenDialog, answerSaveDialog, ffmpegExe, launchApp, makeNumberedVideo, openTool, stopApp } from './helpers.ts';

const run = promisify(execFile);

/** `window` inside page.evaluate(); this config has no DOM types. */
type PageGlobal = typeof globalThis & { __rezzoPreview?: { readRow(y: number): number[] } };

const W = 1080;
const H = 1920;
/** The clip: 2 s to 6 s of the source. */
const START = 2;
const END = 6;
/** A new text layer is centred across, its middle 0.22 of the way down. */
const ROW = Math.round(0.22 * H);

let dir: string;
let app: ElectronApplication | undefined;
let page: Page;
let file: string;

/** expect.poll() for hooks, where vitest doesn't allow it. */
async function until(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** How many pixels of the preview's ROW are white (letters) and black (outline). */
async function inks(): Promise<{ white: number; black: number; grey: boolean }> {
  const row = await page.evaluate((y) => (globalThis as PageGlobal).__rezzoPreview?.readRow(y) ?? [], ROW);
  let white = 0;
  let black = 0;
  for (let x = 0; x < W; x++) {
    const [r, g, b] = [row[x * 4]!, row[x * 4 + 1]!, row[x * 4 + 2]!];
    if (r > 220 && g > 220 && b > 220) white++;
    if (r < 40 && g < 40 && b < 40) black++;
  }
  // The numbered video's grey background at the left edge: the frame is drawn.
  const grey = [row[0], row[1], row[2]].every((v) => Math.abs(v! - 130) < 12);
  return { white, black, grey };
}

/** Saves and reads the file back once the save has finished. */
async function saved(): Promise<Project> {
  await page.keyboard.press('Control+S');
  await expect.poll(() => page.locator('.topbar .dirty').count()).toBe(0);
  return JSON.parse(await readFile(file, 'utf8')) as Project;
}

const textLayers = (p: Project) => p.clips[0]!.layers.filter((l): l is TextLayer => l.kind === 'text');

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
  // The clip list shows once there's a transcript.
  project.transcript = {
    language: 'sr',
    model: 'test',
    createdAt: new Date().toISOString(),
    startShift: -0.1,
    segments: [{ start: 2.1, end: 2.5, words: [{ text: 'Naslov.', start: 2.1, end: 2.5, p: 0.9 }] }],
  };
  project.clips = [{ id: crypto.randomUUID(), name: 'Naslov', start: START, end: END, skips: [], evenLoudness: false, layers: [defaultVideoLayer(START)] }];
  await writeFile(file, JSON.stringify(project));
  await page.getByRole('button', { name: /numbered/ }).click();
  await page.locator('.clip-list li', { hasText: 'Naslov' }).getByRole('button', { name: 'Naslov' }).click();
  await until(async () => (await inks()).grey, 20_000);
  await analysisDone(page);
});

afterAll(async () => {
  await stopApp(app);
  await rm(dir, { recursive: true, force: true });
});

describe('text layers', () => {
  it('adds text from the playhead on, drawn over the picture', async () => {
    // Nothing white or black on that row of the video itself.
    expect(await inks()).toMatchObject({ white: 0, black: 0 });
    // One second in: the text starts there.
    await page.keyboard.press('Shift+ArrowRight');
    await openTool(page, 'Layers');
    await page.locator('.add-tiles').getByRole('button', { name: 'Text' }).click();
    await page.getByRole('heading', { name: 'Text: Your title here' }).waitFor();
    expect(await page.locator('.clip-timeline .layer-bar.text').count()).toBe(1);

    // It pops in over 0.35 s; fifteen frames later it's all there.
    for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await inks()).white, { timeout: 10_000 }).toBeGreaterThan(20);
    expect((await inks()).black).toBeGreaterThan(20);
  });

  it('takes typed text as one undo step', async () => {
    const field = page.locator('.text-field textarea');
    await field.fill('Šta se *desilo*?');
    await page.getByRole('heading', { name: 'Text: Šta se desilo?' }).waitFor();
    await expect.poll(() => page.locator('.clip-timeline .layer-bar.text').textContent()).toContain('Šta se desilo?');
    await field.blur();
    await page.keyboard.press('Control+Z');
    await page.getByRole('heading', { name: 'Text: Your title here' }).waitFor();
    expect(await field.inputValue()).toBe('Your *title* here');
    await page.keyboard.press('Control+Y');
    await page.getByRole('heading', { name: 'Text: Šta se desilo?' }).waitFor();
    expect(await field.inputValue()).toBe('Šta se *desilo*?');
  });

  it('keeps the text in the saved project, with no file of its own', async () => {
    const project = await saved();
    expect(textLayers(project)).toEqual([expect.objectContaining({ text: 'Šta se *desilo*?', start: 3, end: 6 })]);
    expect(project.assets).toEqual([]);
  });

  it('exports the text as the preview draws it', async () => {
    const out = path.join(dir, 'out', 'naslov.mp4');
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
    /** How many pixels of ROW in frame `i` are white and black, by their brightness. */
    const inksAt = (i: number) => {
      let white = 0;
      let black = 0;
      for (let x = 0; x < W; x++) {
        const y = stdout[i * size + ROW * W + x]!;
        if (y > 220) white++;
        if (y < 40) black++;
      }
      return { white, black };
    };
    // Before the text starts, and as it starts popping in: none. Half a second later: all there.
    expect(inksAt(15)).toEqual({ white: 0, black: 0 });
    expect(inksAt(30)).toEqual({ white: 0, black: 0 });
    expect(inksAt(45).white).toBeGreaterThan(20);
    expect(inksAt(45).black).toBeGreaterThan(20);
  });
});
