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
  return save(settingsPatchSchema.parse(patch));
}

/** Remembers the folder of the last export. */
export async function rememberExportDir(dir: string): Promise<void> {
  await save({ exportDir: dir });
}

async function save(patch: Partial<Settings>): Promise<Settings> {
  const next = settingsSchema.parse({ ...(await getSettings()), ...patch });
  await writeFileAtomic(settingsFile(), JSON.stringify(next, null, 2));
  current = next;
  return next;
}

async function load(): Promise<Settings> {
  const defaults: Settings = { uiLanguage: defaultUiLanguage(app.getLocale()), transcriptLanguage: 'sr', exportDir: null, replacements: [] };
  try {
    const stored = JSON.parse(await readFile(settingsFile(), 'utf8'));
    // Each setting stands alone: an unknown or damaged one falls back to its
    // default without taking the others with it.
    const settings: Record<string, unknown> = { ...defaults };
    for (const [key, schema] of Object.entries(settingsSchema.shape)) {
      const parsed = schema.safeParse(stored?.[key]);
      if (parsed.success) settings[key] = parsed.data;
    }
    return settings as Settings;
  } catch {
    return defaults;
  }
}
