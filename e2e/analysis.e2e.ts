/**
 * The clip analysis: camera cuts and MediaPipe in the page. The source is
 * three synthetic shots with hard cuts at 2 s and 4 s and nobody in them,
 * so the test can tell the cuts land on the right frames, MediaPipe loads
 * (its WASM and models, from the installed app too) and finds no one, and
 * the result is kept next to the working file. How well it finds people is
 * measured on real footage in spikes/REPORT.md.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClipAnalysis } from '../src/shared/analysis.ts';
import { openThreeShots, stopApp } from './helpers.ts';

/** `window` inside page.evaluate(); this config has no DOM types. */
type PageGlobal = typeof globalThis & {
  __rezzoAnalysis: { state(): { status: string; detail: string | null; analysis: ClipAnalysis | null }; fail(detail: string): void };
};

let dir: string;
let app: ElectronApplication | undefined;
let page: Page;

const state = () => page.evaluate(() => (globalThis as PageGlobal).__rezzoAnalysis.state());

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-e2e-'));
  ({ app, page } = await openThreeShots(dir));
});

afterAll(async () => {
  await stopApp(app);
  await rm(dir, { recursive: true, force: true });
});

describe('clip analysis', () => {
  it('finds the camera cuts on their frames, and nobody in the shots', async () => {
    await expect.poll(async () => (await state()).status, { timeout: 60_000 }).toMatch(/ready|failed/);
    const s = await state();
    expect(s.detail).toBeNull();
    const shots = s.analysis!.shots;
    expect(shots).toHaveLength(3);
    expect(shots[1]!.start).toBeCloseTo(2, 1);
    expect(shots[2]!.start).toBeCloseTo(4, 1);
    expect(Math.abs(shots[1]!.start * 30 - 60)).toBeLessThan(1.01);
    expect(s.analysis!.seats).toEqual([]);
    await expect.poll(() => page.locator('.clip-timeline .cut').count()).toBe(2);
  });

  it('keeps the result next to the working file', async () => {
    const cache = path.join(dir, 'local', 'cache');
    const files = await readdir(cache, { recursive: true });
    expect(files.some((f) => f.endsWith('.analysis.v1.json'))).toBe(true);
  });

  it('shows the people it found over the picture on request', async () => {
    const toggle = page.getByRole('button', { name: 'Show people' });
    await toggle.click();
    await expect.poll(() => toggle.getAttribute('aria-pressed')).toBe('true');
    await expect.poll(() => page.locator('.people-overlay').count()).toBe(1);
    expect(await page.locator('.people-overlay .person').count()).toBe(0);
  });

  it('says why when the analysis fails, and tries again on request', async () => {
    const frame = page.getByRole('button', { name: 'Auto frame' });
    await expect.poll(() => frame.isEnabled(), { timeout: 30_000 }).toBe(true);
    await page.evaluate(() => (globalThis as PageGlobal).__rezzoAnalysis.fail('the worker stopped'));

    await page.getByText("This clip couldn't be analysed: the worker stopped").waitFor();
    expect(await frame.isDisabled()).toBe(true);
    expect(await frame.getAttribute('title')).toBe('The clip analysis failed');

    await page.getByRole('button', { name: 'Try again' }).click();
    await expect.poll(async () => (await state()).status, { timeout: 60_000 }).toBe('ready');
    await expect.poll(() => frame.isEnabled(), { timeout: 30_000 }).toBe(true);
    expect(await page.getByRole('button', { name: 'Try again' }).count()).toBe(0);
  });
});
