/**
 * The clip analysis: camera cuts and MediaPipe in the page. The source is
 * three synthetic shots with hard cuts at 2 s and 4 s and nobody in them,
 * so the test can tell the cuts land on the right frames, MediaPipe loads
 * (its WASM and models, from the installed app too) and finds no one, and
 * the result is kept next to the working file. How well it finds people is
 * measured on real footage in spikes/REPORT.md.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClipAnalysis } from '../src/shared/analysis.ts';
import { clipFromWords } from '../src/shared/clips.ts';
import type { Project } from '../src/shared/project.ts';
import { answerOpenDialog, answerSaveDialog, ffmpegExe, launchApp, stopApp, until } from './helpers.ts';

const run = promisify(execFile);

/** `window` inside page.evaluate(); this config has no DOM types. */
type PageGlobal = typeof globalThis & { __rezzoAnalysis: { state(): { status: string; detail: string | null; analysis: ClipAnalysis | null } } };

let dir: string;
let app: ElectronApplication | undefined;
let page: Page;

const state = () => page.evaluate(() => (globalThis as PageGlobal).__rezzoAnalysis.state());

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-e2e-'));
  const video = path.join(dir, 'three-shots.mp4');
  await run(ffmpegExe(), [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'color=c=0x802020:size=640x360:rate=30:duration=2',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=2',
    '-f', 'lavfi', '-i', 'color=c=0x2040a0:size=640x360:rate=30:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6',
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
    '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video,
  ]);

  ({ app, page } = await launchApp(dir));
  await answerOpenDialog(app, video);
  await page.getByRole('button', { name: 'New project' }).click();
  const file = path.join(dir, 'three-shots.rezzo');
  await answerSaveDialog(app, file);
  await page.getByRole('textbox', { name: 'Project name' }).waitFor();
  await page.keyboard.press('Control+S');
  await until(async () => (await readFile(file, 'utf8').catch(() => '')).includes('"source"'));
  await page.getByRole('button', { name: 'Close project' }).click();

  const project = JSON.parse(await readFile(file, 'utf8')) as Project;
  const words = Array.from({ length: 11 }, (_, i) => ({ text: `reč${i}`, start: 0.3 + i * 0.5, end: 0.7 + i * 0.5, p: 0.9 }));
  project.transcript = { language: 'sr', model: 'test', createdAt: new Date().toISOString(), startShift: -0.1, segments: [{ start: 0.3, end: 5.7, words }] };
  project.clips = [clipFromWords(words, project.source!)];
  await writeFile(file, JSON.stringify(project));
  await page.getByRole('button', { name: /three-shots/ }).click();
  await page.locator('.clip-list li button').first().click();
});

afterAll(async () => {
  await stopApp(app);
  await rm(dir, { recursive: true, force: true });
});

describe('clip analysis', () => {
  it('finds the camera cuts on their frames, and nobody in the shots', async () => {
    await expect.poll(async () => (await state()).status, { timeout: 60_000 }).toMatch(/ready|failed/);
    const s = await state();
    expect(s.detail).toBeNull();
    const shots = s.analysis!.shots;
    expect(shots).toHaveLength(3);
    expect(shots[1]!.start).toBeCloseTo(2, 1);
    expect(shots[2]!.start).toBeCloseTo(4, 1);
    expect(Math.abs(shots[1]!.start * 30 - 60)).toBeLessThan(1.01);
    expect(s.analysis!.seats).toEqual([]);
    await expect.poll(() => page.locator('.clip-timeline .cut').count()).toBe(2);
  });

  it('keeps the result next to the working file', async () => {
    const cache = path.join(dir, 'local', 'cache');
    const files = await readdir(cache, { recursive: true });
    expect(files.some((f) => f.endsWith('.analysis.v1.json'))).toBe(true);
  });

  it('shows the people it found over the picture on request', async () => {
    const toggle = page.getByRole('button', { name: 'Show people' });
    await toggle.click();
    await expect.poll(() => toggle.getAttribute('aria-pressed')).toBe('true');
    await expect.poll(() => page.locator('.people-overlay').count()).toBe(1);
    expect(await page.locator('.people-overlay .person').count()).toBe(0);
  });
});
