/**
 * The transcript view and the player, without running whisper: the test
 * writes a made-up transcript into a saved project and opens it.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Segment } from '../src/shared/project.ts';
import { answerOpenDialog, answerSaveDialog, launchApp, makeTestVideo, stopApp } from './helpers.ts';

let dir: string;
let app: ElectronApplication | undefined;
let page: Page;

/** expect.poll() for hooks, where vitest doesn't allow it. */
async function until(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Words spaced 0.5 s apart starting at `start`. */
function segment(start: number, text: string): Segment {
  const words = text.split(' ').map((t, i) => ({ text: t, start: start + i * 0.5, end: start + i * 0.5 + 0.4, p: t === 'najbolji.' ? 0.2 : 0.95 }));
  return { start, end: words.at(-1)!.end, words };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-e2e-'));
  const video = await makeTestVideo(path.join(dir, 'show.mp4'), { seconds: 12 });

  ({ app, page } = await launchApp(dir));
  await answerOpenDialog(app, video);
  await page.getByRole('button', { name: 'New project' }).click();
  const file = path.join(dir, 'show.rezzo');
  await answerSaveDialog(app, file);
  await page.getByRole('textbox', { name: 'Project name' }).waitFor();
  await page.keyboard.press('Control+S');
  await until(async () => (await readFile(file, 'utf8').catch(() => '')).includes('"source"'));
  await page.getByRole('button', { name: 'Close project' }).click();

  const project = JSON.parse(await readFile(file, 'utf8'));
  project.transcript = {
    language: 'sr',
    model: 'test',
    createdAt: new Date().toISOString(),
    startShift: -0.1,
    segments: [
      segment(1, 'Dobro veče, danas pričamo o Đokoviću.'),
      segment(5, 'Ćevapi su najbolji.'),
      segment(8, 'A Đoković? Pričamo i o njemu.'),
    ],
  };
  await writeFile(file, JSON.stringify(project));
  await page.getByRole('button', { name: /show/ }).click();
  await page.locator('.transcript .w').first().waitFor();
});

afterAll(async () => {
  await stopApp(app);
  await rm(dir, { recursive: true, force: true });
});

const search = (page: Page) => page.getByRole('searchbox', { name: /Search the transcript/ });

describe('transcript', () => {
  it('shows every word, marking the uncertain ones', async () => {
    expect(await page.locator('.transcript .w').count()).toBe(15);
    expect(await page.locator('.w.unsure').textContent()).toBe('najbolji. ');
  });

  it('plays the source through rezzo-media://', async () => {
    await expect.poll(() => page.locator('video').evaluate((v: { videoWidth: number }) => v.videoWidth)).toBe(640);
  });

  it('seeks the player to a clicked word', async () => {
    await page.locator('.w', { hasText: 'Ćevapi' }).click();
    await expect.poll(() => page.locator('video').evaluate((v: { currentTime: number }) => v.currentTime)).toBeCloseTo(5, 1);
    await expect.poll(() => page.locator('.w.active').textContent()).toBe('Ćevapi ');
  });

  it('searches without diacritics and steps through results', async () => {
    await page.keyboard.press('Control+F');
    await page.keyboard.type('djokovic');
    await expect.poll(() => page.locator('.transcript-search .count').textContent()).toBe('1 of 2');
    expect(await page.locator('.w.hit.current').textContent()).toBe('Đokoviću. ');

    await search(page).press('Enter');
    await expect.poll(() => page.locator('.transcript-search .count').textContent()).toBe('2 of 2');
    expect(await page.locator('.w.hit.current').textContent()).toBe('Đoković? ');

    await search(page).fill('pricamo o');
    await expect.poll(() => page.locator('.transcript-search .count').textContent()).toBe('1 of 1');
    await search(page).fill('zzz');
    await expect.poll(() => page.locator('.transcript-search .count').textContent()).toBe('No matches');
  });
});
