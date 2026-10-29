/** App settings, kept as JSON in the user data folder. */
import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultUiLanguage, settingsPatchSchema, settingsSchema, type Settings } from '../shared/settings.ts';
import { writeFileAtomic } from '../node/files.ts';

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

let current: Settings | undefined;

export async function getSettings(): Promise<Settings> {
  current ??= await load();
  return current;
}

/** Applies a change from the renderer. Unknown keys or bad values are rejected. */
export async function updateSettings(patch: unknown): Promise<Settings> {
  const next = settingsSchema.parse({ ...(await getSettings()), ...settingsPatchSchema.parse(patch) });
  await writeFileAtomic(settingsFile(), JSON.stringify(next, null, 2));
  current = next;
  return next;
}

async function load(): Promise<Settings> {
  const defaults: Settings = { uiLanguage: defaultUiLanguage(app.getLocale()), transcriptLanguage: 'sr' };
  try {
    const stored = JSON.parse(await readFile(settingsFile(), 'utf8'));
    // Unknown keys (from a newer version) are ignored; a damaged file falls
    // back to the defaults instead of stopping the app.
    return { ...defaults, ...settingsSchema.partial().catch({}).parse(stored) };
  } catch {
    return defaults;
  }
}
