/**
 * Taking pauses and words out of a clip: pauses are found from the sound, cut
 * in one undo step, and neither the preview nor the export shows a frame of
 * what was cut. The source shows each frame's number, and its tone stops
 * during the pauses, so the test can read what ended up where.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultVideoLayer } from '../src/shared/framing.ts';
import type { Clip, Project } from '../src/shared/project.ts';
import { analysisDone, answerOpenDialog, answerSaveDialog, ffmpegExe, ffprobeExe, launchApp, makeNumberedVideo, NUMBER_BIT_WIDTH, NUMBER_STRIP_HEIGHT, stopApp, until } from './helpers.ts';

const run = promisify(execFile);

/** `window` inside page.evaluate(); this config has no DOM types. */
type PageGlobal = typeof globalThis & { __rezzoPreview?: { readRow(y: number): number[] } };

const W = 1080;
const H = 1920;
const FPS = 30;
const START = 4;
const END = 14;
/** Where the tone stops. */
const QUIET: [number, number][] = [[6, 7.5], [11, 12]];
/** With 0.1 s of air on each side, on whole frames. */
const CUT_SECONDS = 1.3 + 0.8;

let dir: string;
let app: ElectronApplication | undefined;
let page: Page;

const SCALE = W / 1280;
const NUMBER_ROW = Math.round((H - 720 * SCALE) / 2 + (NUMBER_STRIP_HEIGHT / 2) * SCALE);
const bitX = (b: number) => Math.round((b + 0.5) * NUMBER_BIT_WIDTH * SCALE);

/** Every frame number in `file`, in order. */
async function exportedNumbers(file: string): Promise<number[]> {
  const { stdout } = await run(ffmpegExe(), ['-v', 'error', '-i', file, '-map', '0:v', '-vf', `format=gray,crop=${W}:1:0:${NUMBER_ROW}`, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], {
    encoding: 'buffer',
    maxBuffer: 1 << 28,
  });
  const numbers: number[] = [];
  for (let o = 0; o + W <= stdout.length; o += W) {
    let n = 0;
    for (let b = 0; b < 16; b++) if (stdout[o + bitX(b)]! > 128) n |= 1 << b;
    numbers.push(n);
  }
  return numbers;
}

async function durations(file: string): Promise<Record<string, number>> {
  const { stdout } = await run(ffprobeExe(), ['-v', 'error', '-show_entries', 'stream=codec_type,duration', '-of', 'json', file]);
  const { streams } = JSON.parse(stdout) as { streams: { codec_type: string; duration: string }[] };
  return Object.fromEntries(streams.map((s) => [s.codec_type, Number(s.duration)]));
}

async function exportClip(out: string): Promise<void> {
  await answerSaveDialog(app!, out);
  await page.locator('.clip-list li').first().getByRole('button', { name: 'Export' }).click();
  await page.locator('.export-dialog').getByRole('button', { name: 'Close', exact: true }).click({ timeout: 60_000 });
  await expect.poll(() => page.locator('.export-dialog[open]').count()).toBe(0);
}

const totalTime = async () => (await page.locator('.transport .time').textContent()) ?? '';
const panel = () => page.getByRole('group', { name: 'Removing pauses' });

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-e2e-'));
  const video = await makeNumberedVideo(path.join(dir, 'numbered.mp4'), { seconds: 20, quiet: QUIET });
  ({ app, page } = await launchApp(dir));
  await answerOpenDialog(app, video);
  await page.getByRole('button', { name: 'New project' }).click();
  const file = path.join(dir, 'numbered.rezzo');
  await answerSaveDialog(app, file);
  await page.getByRole('textbox', { name: 'Project name' }).waitFor();
  await page.keyboard.press('Control+S');
  await until(async () => (await readFile(file, 'utf8').catch(() => '')).includes('"source"'));
  await page.getByRole('button', { name: 'Close project' }).click();

  const project = JSON.parse(await readFile(file, 'utf8')) as Project;
  const word = (text: string, start: number, end: number) => ({ text, start, end, p: 0.9 });
  project.transcript = {
    language: 'sr',
    model: 'test',
    createdAt: new Date().toISOString(),
    startShift: -0.1,
    segments: [{ start: 4.2, end: 13.8, words: [word('Prva', 4.2, 5.8), word('druga', 7.7, 9), word('treća', 9.2, 10.8), word('četvrta', 12.2, 13.8)] }],
  };
  const layer = defaultVideoLayer(START);
  layer.layout = [{ t: START, value: 'full', ease: 'cut' }];
  const clip: Clip = { id: crypto.randomUUID(), name: 'Pauze', start: START, end: END, skips: [], layers: [layer] };
  project.clips = [clip];
  await writeFile(file, JSON.stringify(project));
  await page.getByRole('button', { name: /numbered/ }).click();
  await page.locator('.clip-list li').first().waitFor();
  await page.locator('.clip-list li .name').first().click();
  await panel().getByRole('button', { name: 'Find pauses' }).and(page.locator(':enabled')).waitFor({ timeout: 60_000 });
  await analysisDone(page);
});

afterAll(async () => {
  await stopApp(app);
  await rm(dir, { recursive: true, force: true });
});

describe('removing pauses', () => {
  it('marks the pauses first and cuts nothing until told to', async () => {
    await panel().getByRole('button', { name: 'Find pauses' }).click();
    await expect.poll(() => page.locator('.found-pause.on').count()).toBe(2);
    expect(await panel().getByRole('status').textContent()).toContain('Pauses to remove: 2');
    expect(await totalTime()).toContain('0:10');
  });

  it('keeps a pause that is switched off', async () => {
    await page.locator('.found-pause').first().dispatchEvent('pointerdown');
    await expect.poll(() => page.locator('.found-pause.on').count()).toBe(1);
    await page.locator('.found-pause').first().dispatchEvent('pointerdown');
    await expect.poll(() => page.locator('.found-pause.on').count()).toBe(2);
  });

  it('cuts them in one undo step', async () => {
    await panel().getByRole('button', { name: 'Remove' }).click();
    await expect.poll(() => page.locator('.clip-timeline .skip').count()).toBe(2);
    expect(await totalTime()).toContain('0:07');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => page.locator('.clip-timeline .skip').count()).toBe(0);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(() => page.locator('.clip-timeline .skip').count()).toBe(2);
  });

  it('plays over the cuts without showing a frame of them', async () => {
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    const frames = await page.evaluate(
      async ({ row, xs, ms }) => {
        const out: { n: number; at: number }[] = [];
        const preview = (globalThis as PageGlobal).__rezzoPreview!;
        const raf = (globalThis as unknown as { requestAnimationFrame(f: () => void): void }).requestAnimationFrame;
        const started = performance.now();
        while (performance.now() - started < ms) {
          const line = preview.readRow(row);
          let n = 0;
          xs.forEach((x, b) => {
            if (line[x * 4]! > 128) n |= 1 << b;
          });
          if (out.at(-1)?.n !== n) out.push({ n, at: performance.now() - started });
          await new Promise<void>((r) => raf(() => r()));
        }
        return out;
      },
      { row: NUMBER_ROW, xs: [...Array(16).keys()].map(bitX), ms: 6000 },
    );
    await page.getByRole('button', { name: 'Pause', exact: true }).click();

    const inSkip = (n: number) => (n / FPS > 6.1 + 1e-6 && n / FPS < 7.4 - 1e-6) || (n / FPS > 11.1 + 1e-6 && n / FPS < 11.9 - 1e-6);
    expect(frames.length).toBeGreaterThan(20);
    expect(frames.filter((f) => inSkip(f.n))).toEqual([]);
  });

  it('exports what was kept: every frame once, with the sound as long as the picture', async () => {
    const out = path.join(dir, 'out.mp4');
    await exportClip(out);
    const numbers = await exportedNumbers(out);
    const kept = (END - START - CUT_SECONDS) * FPS;
    expect(numbers.length).toBeCloseTo(kept, -1);
    for (let i = 1; i < numbers.length; i++) expect(numbers[i]!).toBeGreaterThan(numbers[i - 1]!);
    const jumps = numbers.slice(1).flatMap((n, i) => (n - numbers[i]! > 1 ? [[numbers[i]!, n]] : []));
    expect(jumps).toHaveLength(2);
    expect(jumps[0]![0]! / FPS).toBeCloseTo(6.1, 0);
    expect(jumps[0]![1]! / FPS).toBeCloseTo(7.4, 0);
    const { video, audio } = await durations(out);
    expect(Math.abs(audio! - video!)).toBeLessThan(0.1);
  });

  it('brings one cut back with a click, and all with the button', async () => {
    await page.locator('.clip-timeline .skip').first().dispatchEvent('pointerdown');
    await expect.poll(() => page.locator('.clip-timeline .skip').count()).toBe(1);
    await panel().getByRole('button', { name: 'Restore all cuts' }).click();
    await expect.poll(() => page.locator('.clip-timeline .skip').count()).toBe(0);
    expect(await totalTime()).toContain('0:10');
  });
});

describe('cutting words', () => {
  it('cuts the selected words from the open clip and marks them in the transcript', async () => {
    const from = await page.locator('.w', { hasText: 'druga' }).boundingBox();
    const to = await page.locator('.w', { hasText: 'treća' }).boundingBox();
    await page.mouse.move(from!.x + 5, from!.y + from!.height / 2);
    await page.mouse.down();
    await page.mouse.move(to!.x + 5, to!.y + to!.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Cut from clip' }).click();
    await expect.poll(() => page.locator('.w.cut-from-clip').count()).toBe(2);
    await expect.poll(() => page.locator('.clip-timeline .skip').count()).toBe(1);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => page.locator('.w.cut-from-clip').count()).toBe(0);
  });
});
