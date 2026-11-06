/**
 * `npm run dev`: the other tests run the build, and the dev server serves
 * some things differently. The clip analysis once failed only here, since
 * MediaPipe's classic worker needs bundling that the dev server doesn't do.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClipAnalysis } from '../src/shared/analysis.ts';
import { openThreeShots, startDevServer, stopApp } from './helpers.ts';

/** `window` inside page.evaluate(); this config has no DOM types. */
type PageGlobal = typeof globalThis & { __rezzoAnalysis: { state(): { status: string; detail: string | null; analysis: ClipAnalysis | null } } };

// The installed app has no dev server.
describe.skipIf(process.env['REZZO_E2E_EXECUTABLE'])('the app on the dev server', () => {
  let dir: string;
  let server: Awaited<ReturnType<typeof startDevServer>> | undefined;
  let app: ElectronApplication | undefined;
  let page: Page;

  const state = () => page.evaluate(() => (globalThis as PageGlobal).__rezzoAnalysis.state());

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'rezzo-e2e-'));
    server = await startDevServer();
    ({ app, page } = await openThreeShots(dir, server.url));
  }, 120_000);

  afterAll(async () => {
    await stopApp(app);
    server?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('analyses a clip', async () => {
    await expect.poll(async () => (await state()).status, { timeout: 60_000 }).toMatch(/ready|failed/);
    const s = await state();
    expect(s.detail).toBeNull();
    expect(s.analysis!.shots).toHaveLength(3);
    // It waits for the voices too, which take a while on CI.
    await expect.poll(() => page.getByRole('button', { name: 'Auto frame' }).isEnabled(), { timeout: 30_000 }).toBe(true);
  });
});
