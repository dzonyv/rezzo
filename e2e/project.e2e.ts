/**
 * Project lifecycle against the built app. Native file dialogs are replaced
 * in the main process so the tests can choose the file.
 */
import { copyFile, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RezzoApi } from '../src/shared/api.ts';
import { answerOpenDialog, answerSaveDialog, launchApp, makeTestVideo, stopApp, type Launched } from './helpers.ts';

type PageGlobal = typeof globalThis & { rezzo: RezzoApi };

let fixtures: string;
let video: string;
let dir: string;
let app: ElectronApplication | undefined;

async function launch(): Promise<Launched> {
  const launched = await launchApp(dir);
  app = launched.app;
  return launched;
}

async function stop(): Promise<void> {
  await stopApp(app);
  app = undefined;
}

const nameField = (page: Page) => page.getByRole('textbox', { name: 'Project name' });

/** New project from `file` through the (stubbed) Open dialog. */
async function newProjectFrom(a: ElectronApplication, page: Page, file: string) {
  await answerOpenDialog(a, file);
  await page.getByRole('button', { name: 'New project' }).click();
}

beforeAll(async () => {
  fixtures = await mkdtemp(path.join(tmpdir(), 'rezzo-fixtures-'));
  video = await makeTestVideo(path.join(fixtures, 'test-episode.mp4'));
  return () => rm(fixtures, { recursive: true, force: true });
});

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-e2e-'));
});

afterEach(async () => {
  await stop();
  await rm(dir, { recursive: true, force: true });
});

describe('projects', () => {
  it('starts from a video, renames with undo, saves and reopens', async () => {
    const { app: a, page } = await launch();
    await newProjectFrom(a, page, video);
    await expect.poll(() => nameField(page).inputValue()).toBe('test-episode');
    await expect.poll(() => page.locator('.source-panel dd').first().textContent()).toBe('0:03');
    expect(await page.locator('.source-panel').textContent()).toContain('640×360, 30 fps, h264');

    await nameField(page).fill('Episode 12');
    await nameField(page).press('Enter');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => nameField(page).inputValue()).toBe('test-episode');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(() => nameField(page).inputValue()).toBe('Episode 12');

    const file = path.join(dir, 'episode.rezzo');
    await answerSaveDialog(a, file);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => JSON.parse(await readFile(file, 'utf8').catch(() => '{}')).name).toBe('Episode 12');
    await expect.poll(() => page.locator('.dirty').count()).toBe(0);
    expect(await page.title()).toBe('Episode 12 — Rezzo');

    await page.getByRole('button', { name: 'Close project' }).click();
    await page.getByRole('button', { name: /Episode 12/ }).click();
    await expect.poll(() => nameField(page).inputValue()).toBe('Episode 12');
  });

  it('refuses files without a picture', async () => {
    const { app: a, page } = await launch();
    const audio = await makeTestVideo(path.join(dir, 'only-sound.m4a'), { audioOnly: true });
    await newProjectFrom(a, page, audio);
    await expect.poll(() => page.locator('.notice.error').textContent()).toContain('has no picture');
  });

  it('finds the video again after it moved, but only the same video', async () => {
    const moved = path.join(dir, 'moved.mp4');
    await copyFile(video, path.join(dir, 'original.mp4'));
    let { app: a, page } = await launch();
    await newProjectFrom(a, page, path.join(dir, 'original.mp4'));
    await nameField(page).waitFor();
    const file = path.join(dir, 'p.rezzo');
    await answerSaveDialog(a, file);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => page.locator('.dirty').count()).toBe(0);
    await stop();

    await rename(path.join(dir, 'original.mp4'), moved);
    ({ app: a, page } = await launch());
    await page.getByRole('button', { name: /original/ }).click();
    await expect.poll(() => page.locator('.banner.warning').count()).toBe(1);

    const other = await makeTestVideo(path.join(dir, 'other.mp4'), { seconds: 2 });
    await answerOpenDialog(a, other);
    await page.getByRole('button', { name: 'Find it…' }).click();
    await expect.poll(() => page.locator('.notice.error').textContent()).toContain('different video');

    await answerOpenDialog(a, moved);
    await page.getByRole('button', { name: 'Find it…' }).click();
    await expect.poll(() => page.locator('.banner.warning').count()).toBe(0);
    expect(await page.locator('.source-panel h2').textContent()).toBe('moved.mp4');
  });

  it('asks about unsaved changes when the window closes', async () => {
    const { app: a, page } = await launch();
    await newProjectFrom(a, page, video);
    await nameField(page).fill('Draft');
    await nameField(page).press('Enter');

    await a.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(await nameField(page).inputValue()).toBe('Draft');

    const closed = a.waitForEvent('close');
    await a.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    await page.getByRole('button', { name: "Don't save" }).click();
    await closed;
    app = undefined;
  });

  it('offers unsaved work after a crash', async () => {
    let { page } = await launch();
    await page.evaluate(async () => {
      const project = { format: 1 as const, id: '0b6f2a52-9d0c-4f39-8f39-7f0e2c9b1a11', name: 'Lost work', source: null, transcript: null };
      await (globalThis as PageGlobal).rezzo.invoke('project:autosave', project, null);
    });
    await stop();

    ({ page } = await launch());
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect.poll(() => nameField(page).inputValue()).toBe('Lost work');
    expect(await page.locator('.dirty').count()).toBe(1);
  });

  it('reports a file that is not a project', async () => {
    const { app: a, page } = await launch();
    const bogus = path.join(dir, 'bogus.rezzo');
    await writeFile(bogus, 'hello');
    await answerOpenDialog(a, bogus);
    await page.getByRole('button', { name: 'Open project…' }).click();
    await expect.poll(() => page.locator('.notice.error').textContent()).toContain("isn't a Rezzo project");
  });
});
