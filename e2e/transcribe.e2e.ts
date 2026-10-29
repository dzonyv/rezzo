/**
 * Transcription with the real whisper.cpp and model, on a video you choose:
 *
 *   REZZO_E2E_VIDEO=D:\path\clip.mp4 REZZO_E2E_LANGUAGE=sr npm run test:e2e
 *
 * Skipped otherwise (CI has no GPU and shouldn't download 1.3 GB). It uses
 * your real tools folder (%LOCALAPPDATA%\Rezzo), so the download happens at
 * most once. Nothing from the video is written into the repo.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ElectronApplication } from 'playwright-core';
import { _electron as electron } from 'playwright-core';
import { afterAll, describe, expect, it } from 'vitest';
import { answerOpenDialog, answerSaveDialog, stopApp } from './helpers.ts';

const video = process.env['REZZO_E2E_VIDEO'];
const language = process.env['REZZO_E2E_LANGUAGE'] ?? 'sr';
let app: ElectronApplication | undefined;
let profile: string | undefined;

afterAll(async () => {
  await stopApp(app);
  if (profile) await rm(profile, { recursive: true, force: true });
});

describe.skipIf(!video)('transcription (real footage)', () => {
  it('transcribes to Latin text with word timings', { timeout: 30 * 60_000 }, async () => {
    profile = await mkdtemp(path.join(tmpdir(), 'rezzo-e2e-'));
    app = await electron.launch({
      args: [path.resolve('out/main/index.js')],
      env: { ...process.env, REZZO_USER_DATA: profile, ELECTRON_RENDERER_URL: '' },
    });
    const page = await app.firstWindow();
    await answerOpenDialog(app, video!);
    await page.getByRole('button', { name: 'New project' }).click();
    await page.getByRole('combobox', { name: 'Spoken language' }).selectOption(language);

    const started = Date.now();
    await page.getByRole('button', { name: 'Transcribe', exact: true }).click();
    await page.locator('.transcript-summary, .transcript').first().waitFor({ timeout: 30 * 60_000 });
    const seconds = (Date.now() - started) / 1000;

    // Read the transcript back from a saved project file.
    const file = path.join(profile, 'p.rezzo');
    await answerSaveDialog(app, file);
    await page.keyboard.press('Control+S');
    await expect.poll(() => readFile(file, 'utf8').catch(() => ''), { timeout: 10_000 }).toContain('"segments"');
    const { transcript } = JSON.parse(await readFile(file, 'utf8')) as {
      transcript: { segments: { words: { text: string; start: number; end: number }[] }[] };
    };
    const words = transcript.segments.flatMap((s) => s.words);
    console.log(`transcribed ${words.length} words in ${seconds.toFixed(1)} s`);

    expect(words.length).toBeGreaterThan(20);
    expect(words.map((w) => w.text).join(' ')).not.toMatch(/[\u0400-\u04FF]/);
    for (const w of words) expect(w.end).toBeGreaterThanOrEqual(w.start);
    // Starts never run backwards by more than a little (DTW can wobble).
    for (let i = 1; i < words.length; i++) expect(words[i]!.start).toBeGreaterThan(words[i - 1]!.start - 1);
  });
});
