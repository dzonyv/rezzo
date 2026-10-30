/**
 * End-to-end checks against the built app (`npm run build` first).
 * Each test gets a fresh user data folder.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RezzoApi } from '../src/shared/api.ts';
import { appToLaunch } from './helpers.ts';

/** `window` inside page.evaluate(); this config has no DOM types. */
type PageGlobal = typeof globalThis & { rezzo: RezzoApi; require?: unknown };

let userData: string;
let app: ElectronApplication | undefined;

async function launch(): Promise<ElectronApplication> {
  app = await electron.launch({
    ...appToLaunch(),
    env: { ...process.env, REZZO_USER_DATA: userData, ELECTRON_RENDERER_URL: '' },
  });
  return app;
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
    await expect.poll(() => page.locator('h1').textContent()).toBe('Rezzo');
    expect(await page.evaluate(() => typeof (globalThis as PageGlobal).require)).toBe('undefined');
    expect(await page.evaluate(() => typeof (globalThis as PageGlobal).rezzo.invoke)).toBe('function');
  });

  it('switches the UI language and remembers it', async () => {
    let page = await (await launch()).firstWindow();
    await page.locator('.language select').selectOption('sh');
    await expect.poll(() => page.locator('.tagline').textContent()).toBe('Vertikalni klipovi iz podkasta i tok-šoua');

    const stored = JSON.parse(await readFile(path.join(userData, 'settings.json'), 'utf8'));
    expect(stored.uiLanguage).toBe('sh');

    await app!.close();
    page = await (await launch()).firstWindow();
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
