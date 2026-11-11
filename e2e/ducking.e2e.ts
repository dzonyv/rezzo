/**
 * "Quieter while someone talks": a clip whose own sound (the source's
 * 440 Hz tone, standing in for speech) stops for two seconds in the
 * middle, with a sound file of the user's (a steady 3 kHz tone, standing in
 * for music) over all of it. Turned on in the sound's panel, the export has
 * the music 12 dB lower under the "speech" than in the gap; a high-pass
 * filter keeps the two tones apart when measuring.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultVideoLayer } from '../src/shared/framing.ts';
import type { Project, SoundLayer } from '../src/shared/project.ts';
import { fingerprint } from '../src/workers/media/fingerprint.ts';
import { analysisDone, answerOpenDialog, answerSaveDialog, ffmpegExe, launchApp, makeNumberedVideo, openTool, stopApp } from './helpers.ts';

const run = promisify(execFile);

/** The clip: 2 s to 6 s of the source, which is quiet from 3 s to 5 s. */
const START = 2;
const END = 6;

let dir: string;
let app: ElectronApplication | undefined;
let page: Page;
let file: string;

async function until(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** The 3 kHz tone's mean level in `out` over 200 ms from `from` seconds, dB; cut out sample-exactly after decoding. */
async function musicLevel(out: string, from: number): Promise<number> {
  const { stderr } = await run(ffmpegExe(), ['-v', 'info', '-nostats', '-i', out, '-af', `atrim=start=${from}:duration=0.2,highpass=f=2000,highpass=f=2000,volumedetect`, '-f', 'null', '-']);
  return Number(/mean_volume: (-?[\d.]+) dB/.exec(stderr)![1]);
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-e2e-'));
  const video = await makeNumberedVideo(path.join(dir, 'numbered.mp4'), { seconds: 10, quiet: [[3, 5]] });
  const music = path.join(dir, 'music.wav');
  await run(ffmpegExe(), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=3000:sample_rate=48000:duration=4', '-af', 'volume=0.3', music]);

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
    segments: [{ start: 2.1, end: 2.5, words: [{ text: 'Muzika.', start: 2.1, end: 2.5, p: 0.9 }] }],
  };
  const asset = { id: crypto.randomUUID(), kind: 'audio' as const, path: music, name: 'music.wav', size: (await stat(music)).size, fingerprint: await fingerprint(music), codec: 'pcm_s16le', duration: 4 };
  const layer: SoundLayer = {
    id: crypto.randomUUID(), kind: 'sound', sound: { assetId: asset.id }, start: START, end: END, offset: 0, volume: 1, fadeIn: 0, fadeOut: 0, loop: false, evenLoudness: false, follows: null,
    duck: { on: false, db: 12 },
  };
  project.assets = [asset];
  project.clips = [{ id: crypto.randomUUID(), name: 'Muzika', start: START, end: END, skips: [], evenLoudness: false, layers: [defaultVideoLayer(START), layer] }];
  await writeFile(file, JSON.stringify(project));
  await page.getByRole('button', { name: /numbered/ }).click();
  await page.locator('.clip-list li', { hasText: 'Muzika' }).getByRole('button', { name: 'Muzika' }).click();
  await analysisDone(page);
});

afterAll(async () => {
  await stopApp(app);
  await rm(dir, { recursive: true, force: true });
});

describe('quieter while someone talks', () => {
  it('is switched on in the sound panel, by 12 dB, and finds the speech', async () => {
    await openTool(page, 'Sound');
    await page.locator('.timeline-row.sound .layer-bar').click();
    await page.getByRole('heading', { name: 'Sound: music.wav' }).waitFor();
    const duck = page.getByRole('switch', { name: 'Quieter while someone talks' });
    expect(await duck.isChecked()).toBe(false);
    await duck.check();
    await expect.poll(() => page.locator('.duck-speech output').textContent()).toBe('−12 dB');
    // Once the speech is found, no word about looking for it is left.
    await expect.poll(() => page.locator('.duck-speech [role="status"]').count(), { timeout: 15_000 }).toBe(0);
    await page.keyboard.press('Control+S');
    await expect.poll(() => page.locator('.topbar .dirty').count()).toBe(0);
    const saved = JSON.parse(await readFile(file, 'utf8')) as Project;
    expect(saved.clips[0]!.layers.find((l) => l.kind === 'sound')).toMatchObject({ duck: { on: true, db: 12 } });
  });

  it('exports the music 12 dB lower under the speech than in the gap', async () => {
    const out = path.join(dir, 'ducked.mp4');
    await answerSaveDialog(app!, out);
    await page.locator('.clip-editor header').getByRole('button', { name: 'Export' }).click();
    await page.getByRole('heading', { name: 'Clip exported' }).waitFor({ timeout: 60_000 });
    await page.locator('.export-dialog').getByRole('button', { name: 'Close', exact: true }).click();

    // Speech from 0 s to 1 s and from 3 s to 4 s into the clip; the gap in between, after the music comes back up.
    const speech = await musicLevel(out, 0.5);
    const gap = await musicLevel(out, 2);
    expect(gap - speech).toBeCloseTo(12, 0);
    expect(await musicLevel(out, 3.5)).toBeCloseTo(speech, 0);
  });
});
