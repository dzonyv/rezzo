/**
 * Making a clip from the transcript and framing it: the working file, the
 * WebGL preview, layouts, keyframes and undo. The source shows each frame's
 * number, so the test reads back which frame the renderer drew.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Project, Segment } from '../src/shared/project.ts';
import {
  answerOpenDialog, answerSaveDialog, launchApp, makeNumberedVideo, NUMBER_BIT_WIDTH, NUMBER_STRIP_HEIGHT, stopApp,
} from './helpers.ts';

/** `window` inside page.evaluate(); this config has no DOM types. */
type PageGlobal = typeof globalThis & { __rezzoPreview?: { readRow(y: number): number[]; hasAudio(): boolean | null } };

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

/** Words spaced 0.5 s apart starting at `start`. */
function segment(start: number, text: string): Segment {
  const words = text.split(' ').map((t, i) => ({ text: t, start: start + i * 0.5, end: start + i * 0.5 + 0.4, p: 0.95 }));
  return { start, end: words.at(-1)!.end, words };
}

/**
 * The source frame number in the Full layout, read from the comp: the
 * 1280×720 source is scaled to 1080 wide and centred, so its number strip
 * sits just below (1920 - 607.5) / 2.
 */
async function frameOnScreen(): Promise<number> {
  const scale = 1080 / 1280;
  const y = Math.round((1920 - 720 * scale) / 2 + (NUMBER_STRIP_HEIGHT / 2) * scale);
  const row = await page.evaluate((r) => (globalThis as PageGlobal).__rezzoPreview?.readRow(r) ?? [], y);
  if (row.length === 0) return -1;
  let n = 0;
  for (let b = 0; b < 16; b++) {
    const x = Math.round((b + 0.5) * NUMBER_BIT_WIDTH * scale);
    if (row[x * 4]! > 128) n |= 1 << b;
  }
  return n;
}

async function saved(): Promise<Project> {
  await page.keyboard.press('Control+S');
  let project: Project | undefined;
  await until(async () => {
    project = JSON.parse(await readFile(file, 'utf8')) as Project;
    return project.clips.length > 0;
  });
  return project!;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-e2e-'));
  const video = await makeNumberedVideo(path.join(dir, 'numbered.mp4'));

  ({ app, page } = await launchApp(dir));
  await answerOpenDialog(app, video);
  await page.getByRole('button', { name: 'New project' }).click();
  file = path.join(dir, 'numbered.rezzo');
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
    segments: [segment(1, 'Dobro veče i dobrodošli.'), segment(5, 'Danas pričamo o kadriranju klipova.'), segment(10, 'Hvala što gledate.')],
  };
  await writeFile(file, JSON.stringify(project));
  await page.getByRole('button', { name: /numbered/ }).click();
  await page.locator('.transcript .w').first().waitFor();
});

afterAll(async () => {
  await stopApp(app);
  await rm(dir, { recursive: true, force: true });
});

describe('clips', () => {
  it('makes a clip from words selected by dragging', async () => {
    const from = await page.locator('.w', { hasText: 'Danas' }).boundingBox();
    const to = await page.locator('.w', { hasText: 'klipova.' }).boundingBox();
    await page.mouse.move(from!.x + 5, from!.y + from!.height / 2);
    await page.mouse.down();
    await page.mouse.move(to!.x + 5, to!.y + to!.height / 2, { steps: 8 });
    await page.mouse.up();

    expect(await page.locator('.w.selected').count()).toBe(5);
    await page.getByRole('button', { name: 'Make clip' }).click();

    await expect.poll(() => page.locator('.clip-list li').count()).toBe(1);
    expect(await page.getByRole('textbox', { name: 'Clip name' }).inputValue()).toBe('Danas pričamo o kadriranju klipova');
    expect(await page.locator('.w.in-open-clip').count()).toBe(5);
  });

  it('shows the exact first frame of the clip', async () => {
    // Full frame shows the whole source, number strip included.
    await page.getByRole('button', { name: 'Full frame' }).click();
    // The clip starts 0.1 s before "Danas" (5.0 s): frame 147 at 30 fps.
    await expect.poll(frameOnScreen, { timeout: 20_000 }).toBe(147);
  });

  it('reads the sound from the working file', async () => {
    // Web Audio decodes the AAC track; without it the clip would play silently.
    expect(await page.evaluate(() => (globalThis as PageGlobal).__rezzoPreview?.hasAudio())).toBe(true);
  });

  it('steps frame by frame', async () => {
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await expect.poll(frameOnScreen).toBe(150);
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(frameOnScreen).toBe(180);
  });

  it('plays and pauses with Space', async () => {
    await page.keyboard.press('Space');
    await new Promise((r) => setTimeout(r, 700));
    await page.keyboard.press('Space');
    const frame = await frameOnScreen();
    // About 0.7 s of 30 fps from frame 180, allowing for audio start-up.
    expect(frame).toBeGreaterThan(190);
    expect(frame).toBeLessThan(205);
    // Back to where the next test expects to be.
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowRight');
    for (let i = frame - 180; i > 0; i--) await page.keyboard.press('ArrowLeft');
    await expect.poll(frameOnScreen).toBe(180);
  });

  it('switches layout from the playhead on, with undo', async () => {
    await page.getByRole('button', { name: 'Follow' }).click();
    await expect.poll(() => page.locator('.clip-timeline .band').count()).toBe(2);

    let project = await saved();
    expect(project.clips[0]!.layers[0]!.layout.map((k) => [k.t, k.value])).toEqual([[4.9, 'full'], [6, 'follow']]);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => page.locator('.clip-timeline .band').count()).toBe(1);
    await expect.poll(frameOnScreen).toBe(180);
    await page.getByRole('button', { name: 'Redo' }).click();
    await expect.poll(() => page.locator('.clip-timeline .band').count()).toBe(2);

    project = await saved();
    expect(project.clips[0]!.layers[0]!.layout).toHaveLength(2);
  });

  it('frames by dragging the picture, as one undo step', async () => {
    const box = await page.locator('.framing-overlay').boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 40, cy, { steps: 6 });
    await page.mouse.up();

    let project = await saved();
    const follow = project.clips[0]!.layers[0]!.follow;
    // One keyframe, so the whole clip moved: dragging right shows more of the left.
    expect(follow).toHaveLength(1);
    expect(follow[0]!.value.x).toBeLessThan(0.5);
    expect(await page.getByRole('button', { name: 'Undo' }).getAttribute('title')).toBe('Undo: move framing');

    await page.getByRole('button', { name: 'Undo' }).click();
    project = await saved();
    expect(project.clips[0]!.layers[0]!.follow[0]!.value.x).toBe(0.5);
  });

  it('opens again with its clips', async () => {
    await page.getByRole('button', { name: 'Close project' }).click();
    await page.getByRole('button', { name: /numbered/ }).click();
    await expect.poll(() => page.locator('.clip-list li').count()).toBe(1);
    expect(await page.locator('.w.in-clip').count()).toBe(5);
  });
});
