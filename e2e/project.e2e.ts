/**
 * Project lifecycle against the built app. Native file dialogs are replaced
 * in the main process so the tests can choose the file.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RezzoApi } from '../src/shared/api.ts';

type PageGlobal = typeof globalThis & { rezzo: RezzoApi };

let dir: string;
let app: ElectronApplication | undefined;

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  app = await electron.launch({
    args: [path.resolve('out/main/index.js')],
    env: { ...process.env, REZZO_USER_DATA: path.join(dir, 'profile'), ELECTRON_RENDERER_URL: '' },
  });
  const page = await app.firstWindow();
  await page.locator('h1, .topbar').first().waitFor();
  return { app, page };
}

/** The next Save dialog answers with `file`. */
async function answerSaveDialog(a: ElectronApplication, file: string) {
  await a.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: f })) as typeof dialog.showSaveDialog;
  }, file);
}

const nameField = (page: Page) => page.getByRole('textbox', { name: 'Project name' });

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-e2e-'));
});

/** Ends the app without the unsaved-changes question a normal close would ask. */
async function stop(): Promise<void> {
  const a = app;
  app = undefined;
  if (!a) return;
  const exited = a.waitForEvent('close').catch(() => {});
  await a.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {});
  await exited;
}

afterEach(async () => {
  await stop();
  await rm(dir, { recursive: true, force: true });
});

describe('projects', () => {
  it('creates, renames with undo, saves and reopens', async () => {
    const { app: a, page } = await launch();
    await page.getByRole('button', { name: 'New project' }).click();
    await expect.poll(() => nameField(page).inputValue()).toBe('Untitled');

    await nameField(page).fill('Episode 12');
    await nameField(page).press('Enter');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => nameField(page).inputValue()).toBe('Untitled');
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

  it('asks about unsaved changes when the window closes', async () => {
    const { app: a, page } = await launch();
    await page.getByRole('button', { name: 'New project' }).click();
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
      const project = { format: 1, id: '0b6f2a52-9d0c-4f39-8f39-7f0e2c9b1a11', name: 'Lost work', source: null, transcript: null };
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
    await a.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as typeof dialog.showOpenDialog;
    }, bogus);
    await page.getByRole('button', { name: 'Open project…' }).click();
    await expect.poll(() => page.locator('.notice.error').textContent()).toContain("isn't a Rezzo project");
  });
});
