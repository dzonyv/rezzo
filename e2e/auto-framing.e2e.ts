/**
 * Automatic framing. The source is red on the left and blue on the right, so
 * the preview's pixels show who's in the picture. The analysis is put in by
 * hand: two people until 8 s, then a shot with nobody. Voices come from the
 * real pipeline (a low tone, then pink noise, with the number of people set to 2).
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANALYSIS_VERSION, type ClipAnalysis, type Seat } from '../src/shared/analysis.ts';
import { clipFromWords } from '../src/shared/clips.ts';
import { videoLayerOf, type Project } from '../src/shared/project.ts';
import { answerOpenDialog, answerSaveDialog, ffmpegExe, launchApp, openTool, seekTimeline, segmentOf, stopApp, until } from './helpers.ts';

const run = promisify(execFile);

/** `window` inside page.evaluate(); this config has no DOM types. */
type PageGlobal = typeof globalThis & {
  __rezzoAnalysis: { state(): { status: string }; set(a: ClipAnalysis): void };
  __rezzoPreview?: { readRow(y: number): number[] };
};

let dir: string;
let app: ElectronApplication | undefined;
let page: Page;
let file: string;

async function framing() {
  await page.keyboard.press('Control+S');
  await expect.poll(() => page.locator('.topbar .dirty').count()).toBe(0);
  const project = JSON.parse(await readFile(file, 'utf8')) as Project;
  return videoLayerOf(project.clips[0]!);
}

const seat = (id: number, x: number): Seat => {
  const box = { x: x - 80, y: 160, w: 160, h: 160 };
  return { id, shot: 0, box, samples: [{ t: 1, box, mouth: null }] };
};

const autoFrame = () => page.getByRole('button', { name: 'Auto frame' }).click();
const undo = () => page.getByRole('button', { name: 'Undo', exact: true }).click();
const layouts = async () => (await framing()).layout.map((k) => k.value);

const seek = (seconds: number) => seekTimeline(page, seconds, 12);

/** The colour in the middle of an output row: who's in the picture there. */
async function colourAt(y: number): Promise<string> {
  const row = await page.evaluate((r) => (globalThis as PageGlobal).__rezzoPreview?.readRow(r) ?? [], y);
  const [r = 0, , b = 0] = row.slice(540 * 4, 540 * 4 + 3);
  return r > b + 60 ? 'red' : b > r + 60 ? 'blue' : 'neither';
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-e2e-'));
  const video = path.join(dir, 'left-right.mp4');
  await run(ffmpegExe(), [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'color=c=red:size=640x720:rate=30:duration=12',
    '-f', 'lavfi', '-i', 'color=c=blue:size=640x720:rate=30:duration=12',
    '-f', 'lavfi', '-i', 'sine=frequency=150:sample_rate=48000:duration=6',
    '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.3:sample_rate=48000:duration=6',
    '-filter_complex', '[0:v][1:v]hstack[v];[2:a][3:a]concat=n=2:v=0:a=1[a]',
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video,
  ]);

  ({ app, page } = await launchApp(dir));
  await answerOpenDialog(app, video);
  await page.getByRole('button', { name: 'New project' }).click();
  file = path.join(dir, 'left-right.rezzo');
  await answerSaveDialog(app, file);
  await page.getByRole('textbox', { name: 'Project name' }).waitFor();
  await page.keyboard.press('Control+S');
  await until(async () => (await readFile(file, 'utf8').catch(() => '')).includes('"source"'));
  await page.getByRole('button', { name: 'Close project' }).click();

  const project = JSON.parse(await readFile(file, 'utf8')) as Project;
  const segments = [segmentOf(0.2, 2.2), segmentOf(2.8, 4.8), segmentOf(6.3, 7.8)];
  project.transcript = { language: 'sr', model: 'test', createdAt: new Date().toISOString(), startShift: -0.1, segments };
  project.voices.count = 2;
  project.clips = [{ ...clipFromWords(segments.flatMap((s) => s.words), project.source!), start: 0, end: 12 }];
  await writeFile(file, JSON.stringify(project));
  await page.getByRole('button', { name: /left-right/ }).click();
  await until(async () => (await page.locator('.voice-list li').count()) === 2, 30_000);
  await page.locator('.clip-list li button').first().click();

  await until(async () => /ready|failed/.test(await page.evaluate(() => (globalThis as PageGlobal).__rezzoAnalysis.state().status)), 60_000);
  const shots = [{ start: 0, end: 8 }, { start: 8, end: 12 }];
  const analysis: ClipAnalysis = { version: ANALYSIS_VERSION, start: 0, end: 12, width: 1280, height: 720, shots, seats: [seat(0, 320), seat(1, 960)] };
  await page.evaluate((a) => (globalThis as PageGlobal).__rezzoAnalysis.set(a), analysis);
  await page.getByRole('button', { name: 'Show people' }).click();
  await openTool(page, 'Voices');
});

afterAll(async () => {
  await stopApp(app);
  await rm(dir, { recursive: true, force: true });
});

describe('automatic framing', () => {
  it('shows both people when it can\'t tell, the whole frame with nobody, and undoes in one step', async () => {
    await autoFrame();
    expect(await layouts()).toEqual(['split', 'full']);
    await seek(2);
    await expect.poll(() => colourAt(300)).toBe('red');
    await expect.poll(() => colourAt(1500)).toBe('blue');
    await undo();
    expect(await layouts()).toEqual(['follow']);
  });

  it('follows whoever talks after one click, even one made before the first word', async () => {
    await seek(0.05);
    await page.getByRole('group', { name: 'Who talks now' }).getByRole('button', { name: 'Person 1' }).click();
    await autoFrame();
    expect(await layouts()).toEqual(['follow', 'full']);
    await seek(2);
    await expect.poll(() => colourAt(300)).toBe('red');
    await seek(7);
    await expect.poll(() => colourAt(300)).toBe('blue');
    expect((await framing()).follow.every((k) => Number.isInteger(Math.round(k.t * 30 * 1000) / 1000))).toBe(true);
    await undo();
    expect((await framing()).follow).toHaveLength(1);
  });

  it('redoes only the shot at the playhead', async () => {
    await seek(1);
    await page.getByRole('button', { name: 'This shot' }).click();
    const { layout, follow } = await framing();
    expect(layout.map((k) => k.value)).toEqual(['follow']);
    expect(follow.at(-1)!.t).toBeCloseTo(8, 1);
    await undo();
  });

  it('uses the width asked for', async () => {
    await page.getByRole('group', { name: 'Automatic framing' }).getByRole('combobox', { name: 'Width' }).selectOption('tight');
    await autoFrame();
    expect((await framing()).follow[0]!.value.zoom).toBeGreaterThan(1.2);
  });
});
