/**
 * End-to-end checks against the built app (`npm run build` first).
 * Each test gets a fresh user data folder.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RezzoApi } from '../src/shared/api.ts';
import { appToLaunch, until } from './helpers.ts';

/** `window` inside page.evaluate(); this config has no DOM types. */
type PageGlobal = typeof globalThis & { rezzo: RezzoApi; require?: unknown };

let userData: string;
let app: ElectronApplication | undefined;

async function launch(rendererUrl = ''): Promise<ElectronApplication> {
  app = await electron.launch({
    ...appToLaunch(),
    env: { ...process.env, REZZO_USER_DATA: userData, ELECTRON_RENDERER_URL: rendererUrl },
  });
  return app;
}

/** Closes the window from the main process and waits for the app to end, which it must do without the renderer's help. */
async function closesOnItsOwn(launched: ElectronApplication): Promise<void> {
  const closed = launched.waitForEvent('close', { timeout: 10_000 });
  await launched.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
  await closed;
  app = undefined;
}

beforeEach(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'rezzo-e2e-'));
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  await rm(userData, { recursive: true, force: true });
});

describe('app', () => {
  it('starts with a sandboxed renderer', async () => {
    const page = await (await launch()).firstWindow();
    // Not expect.poll: its one second is about what a start takes on CI, and sometimes less.
    await page.locator('h1').waitFor();
    expect(await page.locator('h1').textContent()).toBe('Rezzo');
    expect(await page.evaluate(() => typeof (globalThis as PageGlobal).require)).toBe('undefined');
    expect(await page.evaluate(() => typeof (globalThis as PageGlobal).rezzo.invoke)).toBe('function');
  });

  // Playwright doesn't finish launching an installed app until its page has loaded.
  it.skipIf(process.env['REZZO_E2E_EXECUTABLE'])('closes straight away while the page is still loading', async () => {
    // A page that never arrives, so the renderer can't be listening yet.
    const server = createServer(() => {});
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const launched = await launch(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
      await until(() => launched.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length > 0));
      await closesOnItsOwn(launched);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it('closes after the page crashed', async () => {
    const launched = await launch();
    await (await launched.firstWindow()).locator('h1').waitFor();
    await launched.evaluate(
      ({ BrowserWindow }) =>
        new Promise<void>((done) => {
          const { webContents } = BrowserWindow.getAllWindows()[0]!;
          webContents.once('render-process-gone', () => done());
          webContents.forcefullyCrashRenderer();
        }),
    );
    await closesOnItsOwn(launched);
  });

  it('closes while the page reloads', async () => {
    const launched = await launch();
    await (await launched.firstWindow()).locator('h1').waitFor();
    const closed = launched.waitForEvent('close', { timeout: 10_000 });
    // As the new page takes over, before it has had a chance to listen.
    await launched.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      win.webContents.once('did-navigate', () => win.close());
      win.webContents.reload();
    });
    await closed;
    app = undefined;
  });

  it('switches the UI language and remembers it', async () => {
    let page = await (await launch()).firstWindow();
    await page.locator('.language select').selectOption('sh');
    await expect.poll(() => page.locator('.tagline').textContent()).toBe('Vertikalni klipovi iz podkasta i tok-šoua');

    const stored = JSON.parse(await readFile(path.join(userData, 'settings.json'), 'utf8'));
    expect(stored.uiLanguage).toBe('sh');

    await app!.close();
    page = await (await launch()).firstWindow();
    await page.locator('h1').waitFor();
    await expect.poll(() => page.locator('html').getAttribute('lang')).toBe('sh');
  });

  it('refuses channels outside the API', async () => {
    const page = await (await launch()).firstWindow();
    await page.locator('h1').waitFor();
    const error = await page.evaluate(() => {
      try {
        void ((globalThis as PageGlobal).rezzo.invoke as (c: string) => Promise<unknown>)('fs:read');
        return 'no error';
      } catch (e) {
        return String(e);
      }
    });
    expect(error).toMatch(/Unknown channel/);
  });
});
