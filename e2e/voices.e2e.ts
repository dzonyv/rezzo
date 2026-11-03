/**
 * Telling voices apart: runs in the background once the project has a
 * transcript, with sherpa-onnx in the media worker. The "voices" are a low
 * tone and pink noise, which is enough to tell the addon loads, the result
 * reaches the episode panel and the number of people setting is used; how
 * well it does on people is measured in spikes/REPORT.md.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Project, Segment } from '../src/shared/project.ts';
import { VOICES_VERSION } from '../src/shared/voices.ts';
import { answerOpenDialog, answerSaveDialog, ffmpegExe, launchApp, stopApp } from './helpers.ts';

const run = promisify(execFile);

let dir: string;
let app: ElectronApplication | undefined;
let page: Page;
let file: string;

/** Words 0.5 s apart from `start` to `end`. */
function segment(start: number, end: number): Segment {
  const words = Array.from({ length: Math.round((end - start) / 0.5) }, (_, i) => ({ text: `reč${i}`, start: start + i * 0.5, end: start + i * 0.5 + 0.4, p: 0.9 }));
  return { start, end: words.at(-1)!.end, words };
}

/** expect.poll() for hooks, where vitest doesn't allow it. */
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

const voiceRows = () => page.locator('.voice-list li');
const countSelect = () => page.getByRole('combobox', { name: 'People talking' });

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-e2e-'));
  // 6 s of a low tone, then 6 s of pink noise.
  const video = path.join(dir, 'two-sounds.mp4');
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
  file = path.join(dir, 'two-sounds.rezzo');
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
    // Pauses of 0.6 s cut the speech into pieces of about 2 s.
    segments: [segment(0.2, 2.2), segment(2.8, 4.8), segment(6.3, 8.3), segment(8.9, 10.9)],
  };
  await writeFile(file, JSON.stringify(project));
  await page.getByRole('button', { name: /two-sounds/ }).click();
  await page.locator('.transcript .w').first().waitFor();
});

afterAll(async () => {
  await stopApp(app);
  await rm(dir, { recursive: true, force: true });
});

describe('voices', () => {
  it('tells the voices apart once there is a transcript, and keeps the result in the cache', async () => {
    await expect.poll(() => voiceRows().count(), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(voiceRows().first().getByRole('textbox').getAttribute('placeholder')).resolves.toBe('Voice 1');
    const project = await saved();
    expect(existsSync(path.join(dir, 'local', 'cache', project.source!.fingerprint, `voices.v${VOICES_VERSION}.json`))).toBe(true);
  });

  it('uses the number of people the user gives, as one undo step', async () => {
    await countSelect().selectOption('2');
    await expect.poll(() => voiceRows().count(), { timeout: 30_000 }).toBe(2);
    expect((await saved()).voices.count).toBe(2);

    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => countSelect().inputValue()).toBe('auto');
    await countSelect().selectOption('1');
    await expect.poll(() => voiceRows().count(), { timeout: 30_000 }).toBe(1);
  });
});
