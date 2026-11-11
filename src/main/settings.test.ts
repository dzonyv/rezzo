import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dir: string;
vi.mock('electron', () => ({ app: { getPath: () => dir, getLocale: () => 'en-US' } }));

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-settings-'));
  vi.resetModules();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('settings', () => {
  it('keeps both of two changes made at the same time', async () => {
    const { getSettings, rememberExportDir, updateSettings } = await import('./settings.ts');
    await Promise.all([updateSettings({ uiLanguage: 'sh' }), updateSettings({ transcriptLanguage: 'hr' }), rememberExportDir(dir)]);
    const expected = { uiLanguage: 'sh', transcriptLanguage: 'hr', exportDir: dir };
    expect(await getSettings()).toMatchObject(expected);
    expect(JSON.parse(await readFile(path.join(dir, 'settings.json'), 'utf8'))).toMatchObject(expected);
  });

  it('carries on after a change that was refused', async () => {
    const { getSettings, updateSettings } = await import('./settings.ts');
    await expect(updateSettings({ uiLanguage: 'xx' })).rejects.toThrow();
    await updateSettings({ transcriptLanguage: 'bs' });
    expect((await getSettings()).transcriptLanguage).toBe('bs');
  });
});
