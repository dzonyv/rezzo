/**
 * Saying who talks. The source is synthetic, so the analysis is put in by
 * hand: one shot with two people. Voices come from the real pipeline (a low
 * tone, then pink noise, with the number of people set to 2).
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
import type { Project, Segment } from '../src/shared/project.ts';
import { answerOpenDialog, answerSaveDialog, ffmpegExe, launchApp, stopApp } from './helpers.ts';

const run = promisify(execFile);

/** `window` inside page.evaluate(); this config has no DOM types. */
type PageGlobal = typeof globalThis & { __rezzoAnalysis: { state(): { status: string }; set(a: ClipAnalysis): void } };

let dir: string;
let app: ElectronApplication | undefined;
let page: Page;
let file: string;

function segment(start: number, end: number): Segment {
  const words = Array.from({ length: Math.round((end - start) / 0.5) }, (_, i) => ({ text: `reč${i}`, start: start + i * 0.5, end: start + i * 0.5 + 0.4, p: 0.9 }));
  return { start, end: words.at(-1)!.end, words };
}

async function until(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function saved(): Promise<Project> {
  await page.keyboard.press('Control+S');
  await expect.poll(() => page.locator('.topbar .dirty').count()).toBe(0);
  return JSON.parse(await readFile(file, 'utf8')) as Project;
}

const seat = (id: number, x: number): Seat => {
  const box = { x: x - 20, y: 60, w: 40, h: 40 };
  return { id, shot: 0, box, samples: [{ t: 1, box, mouth: null }] };
};

const person = (n: number) => page.getByRole('group', { name: 'Who talks now' }).getByRole('button', { name: `Person ${n}` });
const why = () => page.locator('.who-talks .dim').textContent();
const turns = () => page.locator('.clip-timeline .voice-turn');
const undo = () => page.getByRole('button', { name: 'Undo', exact: true }).click();

/** Puts the playhead `seconds` into the 12 s clip by pressing on the timeline. */
async function seek(seconds: number): Promise<void> {
  const timeline = page.locator('.clip-timeline');
  await timeline.scrollIntoViewIfNeeded();
  const box = (await timeline.boundingBox())!;
  await timeline.click({ position: { x: (box.width * seconds) / 12, y: box.height - 4 } });
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-e2e-'));
  const video = path.join(dir, 'two-people.mp4');
  await run(ffmpegExe(), [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=12',
    '-f', 'lavfi', '-i', 'sine=frequency=150:sample_rate=48000:duration=6',
    '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.3:sample_rate=48000:duration=6',
    '-filter_complex', '[1:a][2:a]concat=n=2:v=0:a=1[a]',
    '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video,
  ]);

  ({ app, page } = await launchApp(dir));
  await answerOpenDialog(app, video);
  await page.getByRole('button', { name: 'New project' }).click();
  file = path.join(dir, 'two-people.rezzo');
  await answerSaveDialog(app, file);
  await page.getByRole('textbox', { name: 'Project name' }).waitFor();
  await page.keyboard.press('Control+S');
  await until(async () => (await readFile(file, 'utf8').catch(() => '')).includes('"source"'));
  await page.getByRole('button', { name: 'Close project' }).click();

  const project = JSON.parse(await readFile(file, 'utf8')) as Project;
  const segments = [segment(0.2, 2.2), segment(2.8, 4.8), segment(6.3, 8.3), segment(8.9, 10.9)];
  project.transcript = { language: 'sr', model: 'test', createdAt: new Date().toISOString(), startShift: -0.1, segments };
  project.voices.count = 2;
  project.clips = [{ ...clipFromWords(segments.flatMap((s) => s.words), project.source!), start: 0, end: 12 }];
  await writeFile(file, JSON.stringify(project));
  await page.getByRole('button', { name: /two-people/ }).click();
  await until(async () => (await page.locator('.voice-list li').count()) === 2, 30_000);
  await page.locator('.clip-list li button').first().click();

  await until(async () => /ready|failed/.test(await page.evaluate(() => (globalThis as PageGlobal).__rezzoAnalysis.state().status)), 60_000);
  const analysis: ClipAnalysis = { version: ANALYSIS_VERSION, start: 0, end: 12, width: 320, height: 180, shots: [{ start: 0, end: 12 }], seats: [seat(0, 80), seat(1, 240)] };
  await page.evaluate((a) => (globalThis as PageGlobal).__rezzoAnalysis.set(a), analysis);
  await page.getByRole('button', { name: 'Show people' }).click();
});

afterAll(async () => {
  await stopApp(app);
  await rm(dir, { recursive: true, force: true });
});

describe('saying who talks', () => {
  it("doesn't know with two people in the shot, and marks that on the timeline", async () => {
    await seek(1);
    await expect.poll(why).toContain("Can't tell who talks");
    expect(await page.locator('.clip-timeline .unknown-speaker').count()).toBeGreaterThan(0);
  });

  it('takes a pick for that turn, teaches the rest of the episode, and undoes in one step', async () => {
    await person(1).click();
    await expect.poll(why).toBe('You picked this person');
    await expect.poll(() => person(1).getAttribute('aria-pressed')).toBe('true');
    const [pick] = (await saved()).voices.picks;
    expect(pick!.x).toBeCloseTo(0.25, 2);
    expect(pick!.y).toBeCloseTo(80 / 180, 2);
    expect(pick!.size).toBeCloseTo(40 / 320, 2);
    await expect.poll(() => page.locator('.clip-timeline .speaker-pick').count()).toBe(1);

    // The other voice, in the second half, gets the seat that's left.
    await seek(9);
    await expect.poll(why).toContain('The other person is placed');
    await expect.poll(() => person(2).getAttribute('aria-pressed')).toBe('true');

    await undo();
    await expect.poll(why).toContain("Can't tell who talks");
    expect((await saved()).voices.picks).toEqual([]);
  });

  it('takes a pick back when the same person is clicked again', async () => {
    await seek(1);
    await person(2).click();
    await expect.poll(why).toBe('You picked this person');
    await person(2).click();
    await expect.poll(why).toContain("Can't tell who talks");
    expect((await saved()).voices.picks).toEqual([]);
  });

  it('corrects a turn from the Voices row', async () => {
    const before = await turns().count();
    await turns().first().click({ button: 'right' });
    await page.getByRole('menu').getByRole('button', { name: 'Nobody' }).click();
    await expect.poll(() => turns().count()).toBe(before - 1);
    expect((await saved()).voices.edits).toHaveLength(1);
    await undo();
    await expect.poll(() => turns().count()).toBe(before);
  });

  it('splits a turn, and closes the menu on Escape', async () => {
    const before = await turns().count();
    await turns().first().click({ button: 'right' });
    await page.keyboard.press('Escape');
    await expect.poll(() => page.getByRole('menu').count()).toBe(0);
    await turns().first().click({ button: 'right' });
    await page.getByRole('menu').getByRole('button', { name: 'Split here' }).click();
    await expect.poll(() => turns().count()).toBe(before + 1);
    await undo();
    await expect.poll(() => turns().count()).toBe(before);
  });

  it('merges two voices from the row, and forgets all corrections and picks on request', async () => {
    await seek(1);
    await person(1).click();
    await expect.poll(why).toBe('You picked this person');
    await turns().first().click({ button: 'right' });
    await page.getByRole('menu').getByRole('button', { name: 'Voice 2' }).last().click();
    await expect.poll(() => page.locator('.voice-list li').count()).toBe(1);
    await page.getByRole('button', { name: 'Undo all corrections' }).click();
    await expect.poll(() => page.locator('.voice-list li').count()).toBe(2);
    expect((await saved()).voices).toMatchObject({ edits: [], picks: [] });
  });

  it('names a voice in the episode panel, and the name survives a change of voices', async () => {
    const name = page.getByRole('textbox', { name: 'Name of Voice 1' });
    await name.fill('Ana');
    await name.press('Enter');
    expect((await saved()).voices.edits.at(-1)).toMatchObject({ kind: 'name', name: 'Ana' });
    await page.getByRole('combobox', { name: 'People talking' }).selectOption('1');
    await expect.poll(() => page.locator('.voice-list li').count(), { timeout: 30_000 }).toBe(1);
    await expect.poll(() => page.locator('.voice-list input').inputValue()).toBe('Ana');
  });
});
