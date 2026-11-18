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
    const clipDock = { size: 'compact', height: 300 } as const;
    await Promise.all([updateSettings({ uiLanguage: 'sh' }), updateSettings({ clipDock }), rememberExportDir(dir)]);
    const expected = { uiLanguage: 'sh', clipDock, exportDir: dir };
    expect(await getSettings()).toMatchObject(expected);
    expect(JSON.parse(await readFile(path.join(dir, 'settings.json'), 'utf8'))).toMatchObject(expected);
  });

  it('carries on after a change that was refused', async () => {
    const { getSettings, updateSettings } = await import('./settings.ts');
    await expect(updateSettings({ uiLanguage: 'xx' })).rejects.toThrow();
    await updateSettings({ uiLanguage: 'sh' });
    expect((await getSettings()).uiLanguage).toBe('sh');
  });

  it('keeps the saved templates that are fine when one of them is damaged', async () => {
    const { writeFile } = await import('node:fs/promises');
    const good = { name: 'Moj', template: { layers: [] } };
    const bad = { name: 'Stari', template: { layers: [{ kind: 'effect', effect: 'blur', intensity: 1, params: { amount: 9 } }] } };
    await writeFile(path.join(dir, 'settings.json'), JSON.stringify({ uiLanguage: 'sh', coverTemplates: [bad, good] }));
    const { getSettings } = await import('./settings.ts');
    expect((await getSettings()).coverTemplates).toEqual([good]);
  });

  it('drops the spoken language that older settings files still have', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(dir, 'settings.json'), JSON.stringify({ uiLanguage: 'sh', transcriptLanguage: 'hr' }));
    const { getSettings, updateSettings } = await import('./settings.ts');
    expect(await getSettings()).toMatchObject({ uiLanguage: 'sh' });
    await updateSettings({ uiLanguage: 'en' });
    expect(JSON.parse(await readFile(path.join(dir, 'settings.json'), 'utf8'))).not.toHaveProperty('transcriptLanguage');
  });
});
