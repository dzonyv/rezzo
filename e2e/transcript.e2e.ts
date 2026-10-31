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

  it('corrects words from the keyboard, one undo step each', async () => {
    await search(page).fill('');
    await page.locator('.w', { hasText: 'Ćevapi' }).dblclick();
    const editor = page.getByRole('textbox', { name: 'Correct the word' });
    expect(await editor.inputValue()).toBe('Ćevapi');
    await page.keyboard.type('Čevapi');
    await page.keyboard.press('Tab');
    expect(await editor.inputValue()).toBe('su');
    await page.keyboard.press('Tab');
    await page.keyboard.type('najbolji!');
    await page.keyboard.press('Enter');
    expect(await editor.count()).toBe(0);
    expect(await words(page)).toContain('Čevapi su najbolji!');
    // A corrected word is no longer marked as unsure.
    expect(await page.locator('.w.unsure').count()).toBe(0);

    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(await words(page)).toContain('Čevapi su najbolji.');
    expect(await page.locator('.w.unsure').count()).toBe(1);
  });

  it('splits, joins and deletes words', async () => {
    const editor = page.getByRole('textbox', { name: 'Correct the word' });
    await page.locator('.w', { hasText: 'Dobro' }).dblclick();
    await page.keyboard.type('Do bro');
    await page.keyboard.press('Enter');
    expect(await words(page)).toContain('Do bro veče,');

    await page.locator('.w', { hasText: /^bro $/ }).dblclick();
    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');
    expect(await editor.inputValue()).toBe('Dobro');
    await page.keyboard.press('Escape');
    expect(await words(page)).toContain('Dobro veče,');

    await page.locator('.w', { hasText: 'danas' }).dblclick();
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    expect(await words(page)).toContain('veče, pričamo');
  });

  it('jumps to the next unsure word', async () => {
    await page.locator('.w', { hasText: 'veče,' }).click();
    await page.keyboard.press('Control+ArrowDown');
    const editor = page.getByRole('textbox', { name: 'Correct the word' });
    expect(await editor.inputValue()).toBe('najbolji.');
    await page.keyboard.press('Escape');
  });

  it('learns a replacement from a correction and applies the list as one step', async () => {
    await page.locator('.w', { hasText: 'njemu.' }).dblclick();
    await page.keyboard.type('njima.');
    await page.keyboard.press('Enter');
    await page.getByText('Always replace “njemu” with “njima”?').waitFor();
    await page.getByRole('button', { name: 'Always replace' }).click();

    await page.getByRole('button', { name: 'Replacements' }).click();
    const dialog = page.getByRole('dialog', { name: 'Replacement list' });
    await expect.poll(() => dialog.getByRole('textbox', { name: 'Whisper writes' }).count()).toBe(1);
    expect(await dialog.getByRole('textbox', { name: 'Replace with' }).inputValue()).toBe('njima');
    await dialog.getByRole('button', { name: 'Add a word' }).click();
    await dialog.getByRole('textbox', { name: 'Whisper writes' }).nth(1).fill('pričamo*');
    await dialog.getByRole('textbox', { name: 'Replace with' }).nth(1).fill('govorimo*');
    await dialog.getByRole('button', { name: 'Apply to this transcript' }).click();
    await page.getByText('Words replaced: 2').waitFor();
    await dialog.getByRole('button', { name: 'Done' }).click();

    let text = await words(page);
    expect(text).toContain('veče, govorimo o');
    expect(text).toContain('Govorimo i o njima.');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    text = await words(page);
    expect(text).toContain('veče, pričamo o');
    expect(text).toContain('Pričamo i o njima.');
  });
});

/** The transcript's text as shown, one line per segment. */
const words = (page: Page) => page.locator('.segment-text').allTextContents().then((lines) => lines.map((l) => l.trim()).join('\n'));
