/**
 * Sounds that go with a layer's entrance or exit: picked in the image's
 * panel, placed where the image starts going out, kept there when dragged,
 * moved along with a longer exit, heard there in the export, and deleted
 * with the image. Made here by FFmpeg: a red image, and "tick", 0.1 s of a
 * 3 kHz tone and then silence, which a high-pass filter keeps apart from
 * the source's 440 Hz tone.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultVideoLayer } from '../src/shared/framing.ts';
import { DEFAULT_MOTION } from '../src/shared/motion.ts';
import type { ImageLayer, Project, SoundLayer } from '../src/shared/project.ts';
import { fingerprint } from '../src/workers/media/fingerprint.ts';
import { analysisDone, answerOpenDialog, answerSaveDialog, ffmpegExe, launchApp, makeNumberedVideo, stopApp } from './helpers.ts';

const run = promisify(execFile);

/** The clip: 2 s to 6 s of the source. */
const START = 2;
const END = 6;
/** The image shows from 3 s to 5 s and slides out over its last half second. */
const IMAGE_START = 3;
const IMAGE_END = 5;

let dir: string;
let app: ElectronApplication | undefined;
let page: Page;
let file: string;
let tickFile: string;

async function until(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** The clip's layers and the project's files, as saved. */
async function saved(): Promise<{ sounds: SoundLayer[]; project: Project }> {
  await page.keyboard.press('Control+S');
  await expect.poll(() => page.locator('.topbar .dirty').count()).toBe(0);
  const project = JSON.parse(await readFile(file, 'utf8')) as Project;
  return { sounds: project.clips[0]!.layers.filter((l): l is SoundLayer => l.kind === 'sound'), project };
}

const imageBar = () => page.locator('.clip-timeline .layer-bar', { hasText: 'red.png' });
const exitSound = () => page.getByRole('combobox', { name: 'Sound as it goes out' });

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-e2e-'));
  const video = await makeNumberedVideo(path.join(dir, 'numbered.mp4'), { seconds: 10 });
  const image = path.join(dir, 'red.png');
  await run(ffmpegExe(), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=200x100', '-frames:v', '1', image]);
  tickFile = path.join(dir, 'tick.wav');
  await run(ffmpegExe(), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=3000:sample_rate=48000:duration=0.1', '-af', 'apad=whole_dur=0.3', tickFile]);

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
    segments: [{ start: 2.1, end: 2.5, words: [{ text: 'Zvuk.', start: 2.1, end: 2.5, p: 0.9 }] }],
  };
  const asset = { id: crypto.randomUUID(), kind: 'image' as const, path: image, name: 'red.png', size: (await stat(image)).size, fingerprint: await fingerprint(image), width: 200, height: 100 };
  const layer: ImageLayer = {
    id: crypto.randomUUID(),
    kind: 'image',
    assetId: asset.id,
    start: IMAGE_START,
    end: IMAGE_END,
    transform: [{ t: IMAGE_START, value: { x: 0.5, y: 0.5, scale: 0.6, rotation: 0, opacity: 1 }, ease: 'cut' }],
    motion: { ...DEFAULT_MOTION, out: { kind: 'slide', direction: 'right', seconds: 0.5 } },
    key: null,
  };
  project.assets = [asset];
  project.clips = [{ id: crypto.randomUUID(), name: 'Zvuk', start: START, end: END, skips: [], evenLoudness: false, layers: [defaultVideoLayer(START), layer] }];
  await writeFile(file, JSON.stringify(project));
  await page.getByRole('button', { name: /numbered/ }).click();
  await page.locator('.clip-list li', { hasText: 'Zvuk' }).getByRole('button', { name: 'Zvuk' }).click();
  await analysisDone(page);
});

afterAll(async () => {
  await stopApp(app);
  await rm(dir, { recursive: true, force: true });
});

describe('sounds with an entrance or exit', () => {
  it('offers a sound that suits the exit, and starts it where the image starts going out', async () => {
    await imageBar().click();
    await page.getByRole('heading', { name: 'Image: red.png' }).waitFor();
    // A slide goes with a whoosh.
    await expect.poll(() => exitSound().locator('optgroup[label="Suggested"] option').textContent()).toBe('Whoosh');
    await exitSound().selectOption({ label: 'Whoosh' });
    const { sounds } = await saved();
    expect(sounds).toHaveLength(1);
    expect(sounds[0]).toMatchObject({ sound: { library: 'whoosh' }, follows: { part: 'out', shift: 0 } });
    expect(sounds[0]!.start).toBeCloseTo(IMAGE_END - 0.5, 5);
    await expect.poll(() => page.locator('.timeline-row.sound .track-tag').textContent()).toBe('Whoosh · out');
  });

  it('moves the sound along with a longer exit', async () => {
    // The second Length slider is the exit's.
    await page.getByRole('slider', { name: 'Length' }).nth(1).fill('1');
    expect((await saved()).sounds[0]!.start).toBeCloseTo(IMAGE_END - 1, 5);
  });

  it("keeps the sound with the image when it's dragged, and shows what it goes with", async () => {
    const bar = page.locator('.layer-bar.sound.linked');
    const box = (await bar.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.getByText('Goes with how red.png goes out', { exact: false }).waitFor();
    expect((await saved()).sounds[0]!.start).toBeCloseTo(IMAGE_END - 1, 5);
  });

  it('plays a file of your own there in the export', async () => {
    await imageBar().click();
    await answerOpenDialog(app!, tickFile);
    await exitSound().selectOption({ label: 'Your own file…' });
    await expect.poll(async () => (await saved()).sounds[0]?.sound).toMatchObject({ assetId: expect.any(String) });

    const out = path.join(dir, 'follow.mp4');
    await answerSaveDialog(app!, out);
    await page.locator('.clip-editor header').getByRole('button', { name: 'Export' }).click();
    await page.getByRole('heading', { name: 'Clip exported' }).waitFor({ timeout: 60_000 });
    await page.locator('.export-dialog').getByRole('button', { name: 'Close', exact: true }).click();

    const { stderr } = await run(ffmpegExe(), ['-v', 'info', '-nostats', '-i', out, '-af', 'highpass=f=2000,highpass=f=2000,silencedetect=n=-40dB:d=0.05', '-f', 'null', '-']);
    const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1])).filter((t) => t < END - START - 0.1);
    // The exit starts 1 s before the image's end: 2 s into the clip.
    expect(ends).toHaveLength(1);
    expect(ends[0]).toBeCloseTo(IMAGE_END - 1 - START, 1);
  });

  it('deletes the sound, and its file, with the image', async () => {
    await imageBar().click();
    await page.getByRole('button', { name: 'Delete layer' }).click();
    const { sounds, project } = await saved();
    expect(sounds).toEqual([]);
    expect(project.assets).toEqual([]);
  });
});
