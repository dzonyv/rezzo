/**
 * Disk space, from the home screen: what the cache takes per video, named
 * after the recent project it belongs to, and deleting it.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ElectronApplication } from 'playwright-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { answerOpenDialog, answerSaveDialog, launchApp, makeTestVideo, stopApp } from './helpers.ts';

let dir: string;
let app: ElectronApplication | undefined;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-e2e-'));
});

afterEach(async () => {
  await stopApp(app);
  app = undefined;
  await rm(dir, { recursive: true, force: true });
});

/** The app's fingerprint of a file under 4 MiB (workers/media/fingerprint.ts): the whole file, after its size. */
async function fingerprintOf(file: string): Promise<string> {
  const bytes = await readFile(file);
  return createHash('sha256').update(`rezzo-fingerprint-1:${bytes.length}:`).update(bytes).digest('hex');
}

const cache = () => path.join(dir, 'local', 'cache');

async function cached(fingerprint: string, bytes: number): Promise<void> {
  await mkdir(path.join(cache(), fingerprint, 'work'), { recursive: true });
  await writeFile(path.join(cache(), fingerprint, 'work', 'clip.mp4'), Buffer.alloc(bytes));
}

describe('disk space', () => {
  it('shows what each video takes and deletes it, one or all', async () => {
    const video = await makeTestVideo(path.join(dir, 'test-episode.mp4'));
    const episode = await fingerprintOf(video);
    const stray = 'f'.repeat(64);

    const launched = await launchApp(dir);
    app = launched.app;
    const { page } = launched;
    // A saved project, so the cache folder of its video has a name.
    await answerOpenDialog(app, video);
    await page.getByRole('button', { name: 'New project' }).click();
    await answerSaveDialog(app, path.join(dir, 'episode.rezzo'));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => page.locator('.dirty').count()).toBe(0);
    await page.getByRole('button', { name: 'Close project' }).click();

    await cached(episode, 3_000_000);
    await cached(stray, 1_000_000);
    // Not measured yet: the home screen doesn't walk the cache by itself.
    expect(await page.getByRole('button', { name: /^Disk space/ }).textContent()).toBe('Disk space');
    await page.getByRole('button', { name: /^Disk space/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Disk space' });
    const rows = dialog.locator('li');
    await expect.poll(() => rows.count()).toBe(2);
    // Biggest first, named after the project.
    await expect.poll(() => rows.nth(0).textContent()).toMatch(/test-episode.*3(\.0)? MB/);
    expect(await rows.nth(1).textContent()).toMatch(/Not in recent projects.*1(\.0)? MB/);

    await rows.nth(1).getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog', { name: 'Delete "Not in recent projects"?' }).getByRole('button', { name: 'Delete' }).click();
    await expect.poll(() => rows.count()).toBe(1);
    expect(await readdir(cache())).toEqual([episode]);

    await dialog.getByRole('button', { name: /^Delete all cached files/ }).click();
    await page.getByRole('dialog', { name: 'Delete all cached files?' }).getByRole('button', { name: 'Delete' }).click();
    await expect.poll(() => readdir(cache())).toEqual([]);
    await expect.poll(() => dialog.textContent()).toContain('Nothing is cached.');

    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect.poll(() => page.getByRole('button', { name: /^Disk space/ }).textContent()).toBe('Disk space · 0 B');
  });
});
