/**
 * Sound layers: a sound file and a looped tick written into the project,
 * checked in the export by when they're heard, then sounds added and
 * changed through the Sound drawer and the timeline. The files are made
 * here by FFmpeg, at 3 kHz so a high-pass filter keeps them apart from the
 * source's 440 Hz tone:
 * - "tone": 2 s of a steady tone;
 * - "tick": 0.3 s, a 0.1 s tone and then silence.
 * At the end the clip's own sound is evened out, and the export is louder
 * by the gain the panel shows.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AudioAsset } from '../src/shared/assets.ts';
import { defaultVideoLayer } from '../src/shared/framing.ts';
import type { Project, SoundLayer } from '../src/shared/project.ts';
import { fingerprint } from '../src/workers/media/fingerprint.ts';
import { analysisDone, answerOpenDialog, answerSaveDialog, ffmpegExe, launchApp, makeNumberedVideo, openTool, stopApp } from './helpers.ts';

const run = promisify(execFile);

/** The clip: 2 s to 6 s of the source. */
const START = 2;
const END = 6;

let dir: string;
let app: ElectronApplication | undefined;
let page: Page;
let file: string;
let toneFile: string;

async function until(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Moves the playhead to `t` seconds into the source: back to the clip's start a second at a time, then on by frames. */
async function goTo(t: number): Promise<void> {
  for (let i = 0; i < END - START + 1; i++) await page.keyboard.press('Shift+ArrowLeft');
  const frames = Math.round((t - START) * 30);
  for (let i = 0; i < frames; i++) await page.keyboard.press('ArrowRight');
}

async function audioAsset(file: string, duration: number): Promise<AudioAsset> {
  return {
    id: crypto.randomUUID(),
    kind: 'audio',
    path: file,
    name: path.basename(file),
    size: (await stat(file)).size,
    fingerprint: await fingerprint(file),
    codec: 'pcm_s16le',
    duration,
  };
}

function sound(asset: AudioAsset, patch: Partial<SoundLayer>): SoundLayer {
  return { id: crypto.randomUUID(), kind: 'sound', sound: { assetId: asset.id }, start: START, end: END, offset: 0, volume: 1, fadeIn: 0, fadeOut: 0, loop: false, evenLoudness: false, follows: null, duck: { on: false, db: 12 }, ...patch };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-e2e-'));
  const video = await makeNumberedVideo(path.join(dir, 'numbered.mp4'), { seconds: 10 });
  toneFile = path.join(dir, 'tone.wav');
  await run(ffmpegExe(), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=3000:sample_rate=48000:duration=2', toneFile]);
  const tickFile = path.join(dir, 'tick.wav');
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
  const tone = await audioAsset(toneFile, 2);
  const tick = await audioAsset(tickFile, 0.3);
  project.assets = [tone, tick];
  project.clips = [{
    id: crypto.randomUUID(),
    name: 'Zvuk',
    skips: [],
    evenLoudness: false,
    start: START,
    end: END,
    layers: [
      defaultVideoLayer(START),
      // Heard from 1 s to 2 s into the clip, fading in and out.
      sound(tone, { start: 3, end: 4, offset: 0.5, fadeIn: 0.3, fadeOut: 0.3 }),
      // Ticks at 2.5, 2.8 and 3.1 s into the clip.
      sound(tick, { start: 4.5, end: 5.4, loop: true }),
    ],
  }];
  await writeFile(file, JSON.stringify(project));
  await page.getByRole('button', { name: /numbered/ }).click();
  await page.locator('.clip-list li', { hasText: 'Zvuk' }).getByRole('button', { name: 'Zvuk' }).click();
  await analysisDone(page);
});

afterAll(async () => {
  await stopApp(app);
  await rm(dir, { recursive: true, force: true });
});

describe('sound layers', () => {
  it('shows each sound on a row of its own under the video', async () => {
    const rows = page.locator('.timeline-row.sound');
    await expect.poll(() => rows.count()).toBe(2);
    await expect.poll(() => rows.first().locator('.track-tag').textContent()).toBe('tone.wav');
    // The waveform is drawn once the file is decoded.
    await rows.first().locator('.sound-shape .wave').waitFor({ state: 'attached' });
  });

  it('exports the sounds where they play, faded and looped', async () => {
    const out = path.join(dir, 'sounds.mp4');
    await answerSaveDialog(app!, out);
    await page.locator('.clip-editor header').getByRole('button', { name: 'Export' }).click();
    await page.getByRole('heading', { name: 'Clip exported' }).waitFor({ timeout: 60_000 });
    await page.locator('.export-dialog').getByRole('button', { name: 'Close', exact: true }).click();

    const { stderr } = await run(ffmpegExe(), ['-v', 'info', '-nostats', '-i', out, '-af', 'highpass=f=2000,highpass=f=2000,silencedetect=n=-40dB:d=0.05', '-f', 'null', '-']);
    // silencedetect also ends the last silence where the file ends.
    const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1])).filter((t) => t < END - START - 0.1);
    const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1])).slice(1);
    expect(ends).toHaveLength(4);
    [1, 2.5, 2.8, 3.1].forEach((t, i) => expect(ends[i]).toBeCloseTo(t, 1));
    [2, 2.6, 2.9, 3.2].forEach((t, i) => expect(starts[i]).toBeCloseTo(t, 1));

    // The fade in: quieter just after the start than in the middle.
    const level = async (from: number) => {
      const { stderr: s } = await run(ffmpegExe(), ['-v', 'info', '-nostats', '-ss', String(from), '-t', '0.05', '-i', out, '-af', 'highpass=f=2000,volumedetect', '-f', 'null', '-']);
      return Number(/max_volume: (-?[\d.]+) dB/.exec(s)![1]);
    };
    expect(await level(1.05)).toBeLessThan((await level(1.5)) - 6);
  });
});

describe('adding and changing sounds', () => {
  const sounds = async () => {
    await page.keyboard.press('Control+S');
    await expect.poll(() => page.locator('.topbar .dirty').count()).toBe(0);
    const project = JSON.parse(await readFile(file, 'utf8')) as Project;
    return { layers: project.clips[0]!.layers.filter((l): l is SoundLayer => l.kind === 'sound'), assets: project.assets };
  };

  it('plays a sound from the library to hear it', async () => {
    await openTool(page, 'Sound');
    const listen = page.getByRole('button', { name: 'Listen to Ding' });
    await listen.click();
    await expect.poll(() => listen.getAttribute('aria-pressed')).toBe('true');
    // It stops by itself at its end.
    await expect.poll(() => listen.getAttribute('aria-pressed'), { timeout: 5_000 }).toBe('false');
  });

  it('adds a sound from the library at the playhead, as long as it is', async () => {
    await goTo(2.5);
    await openTool(page, 'Sound');
    await page.locator('.sound-library').getByRole('button', { name: 'Ding', exact: true }).click();
    await page.getByRole('heading', { name: 'Sound: Ding' }).waitFor();
    const added = (await sounds()).layers.at(-1)!;
    expect(added.sound).toEqual({ library: 'ding' });
    expect(added.start).toBeCloseTo(2.5, 5);
    expect(added.end - added.start).toBeCloseTo(22 / 30, 5);
    expect(added).toMatchObject({ offset: 0, volume: 1, fadeIn: 0, fadeOut: 0, loop: false });
  });

  it('changes its volume, fades and loop in the panel', async () => {
    await page.getByRole('slider', { name: 'Volume' }).fill('0.4');
    await page.getByRole('slider', { name: 'Fade in' }).fill('0.2');
    await page.getByRole('checkbox', { name: 'Start over at the end' }).check();
    expect((await sounds()).layers.at(-1)).toMatchObject({ volume: 0.4, fadeIn: 0.2, loop: true });
  });

  it('fades it out by dragging the handle on its bar', async () => {
    const bar = page.locator('.layer-bar.sound.selected');
    const handle = bar.locator('.fade-handle.fadeOut');
    const box = (await handle.boundingBox())!;
    const width = (await bar.boundingBox())!.width;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - width / 4, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    const fadeOut = (await sounds()).layers.at(-1)!.fadeOut;
    expect(fadeOut).toBeGreaterThan(0.1);
    expect(fadeOut).toBeLessThan(0.3);
  });

  it('adds a sound file of your own, as long as it runs', async () => {
    await goTo(3);
    await answerOpenDialog(app!, toneFile);
    await page.getByRole('button', { name: 'Your own file…' }).click();
    await page.getByRole('heading', { name: 'Sound: tone.wav' }).waitFor();
    const { layers, assets } = await sounds();
    const added = layers.at(-1)!;
    expect(added.end - added.start).toBeCloseTo(2, 1);
    // The same file as the one already in the clip: one asset for both.
    expect(assets.filter((a) => a.kind === 'audio')).toHaveLength(2);
    expect(added.sound).toEqual(layers[0]!.sound);
  });
});

describe('evening out loudness', () => {
  /** The source's 440 Hz tone in an export, before any layer is heard: its peak level, dB. */
  const toneLevel = async (out: string) => {
    const { stderr } = await run(ffmpegExe(), ['-v', 'info', '-nostats', '-ss', '0.1', '-t', '0.3', '-i', out, '-af', 'lowpass=f=1000,lowpass=f=1000,volumedetect', '-f', 'null', '-']);
    return Number(/max_volume: (-?[\d.]+) dB/.exec(stderr)![1]);
  };

  it('evens out a sound file of your own from the start, and shows by how much', async () => {
    await expect.poll(() => page.getByRole('switch', { name: 'Even out loudness' }).isChecked()).toBe(true);
    await expect.poll(() => page.locator('.loudness-readout').textContent(), { timeout: 15_000 }).toMatch(/^−\d+\.\d → −\d+\.\d LUFS[+−]\d+\.\d dB$/);
  });

  it("evens out the clip's own sound, and the export is louder by what the panel says", async () => {
    await page.getByRole('button', { name: '← All sounds' }).click();
    const even = page.locator('.clip-loudness').getByRole('switch', { name: 'Even out loudness' });
    // A clip from before evening out keeps sounding as it did.
    expect(await even.isChecked()).toBe(false);
    await even.check();
    const readout = page.locator('.clip-loudness .loudness-readout');
    await expect.poll(() => readout.locator('.gain-chip').textContent(), { timeout: 15_000 }).toMatch(/^\+\d+\.\d dB$/);
    const gain = Number(/\+(\d+\.\d) dB/.exec((await readout.locator('.gain-chip').textContent())!)![1]);
    expect(gain).toBeGreaterThan(3);

    const out = path.join(dir, 'even.mp4');
    await answerSaveDialog(app!, out);
    await page.locator('.clip-editor header').getByRole('button', { name: 'Export' }).click();
    await page.getByRole('heading', { name: 'Clip exported' }).waitFor({ timeout: 60_000 });
    await page.locator('.export-dialog').getByRole('button', { name: 'Close', exact: true }).click();
    expect((await toneLevel(out)) - (await toneLevel(path.join(dir, 'sounds.mp4')))).toBeCloseTo(gain, 0);
  });
});
