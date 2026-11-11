/** App settings, kept as JSON in the user data folder. */
import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultSettings, defaultUiLanguage, settingsPatchSchema, settingsSchema, type Settings } from '../shared/settings.ts';
import { writeFileAtomic } from '../node/files.ts';

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

/** The settings as last read or written. One promise, so two readers at startup don't each read the file. */
let current: Promise<Settings> | undefined;
/** The last change still being written; the next one waits for it. */
let saving: Promise<unknown> = Promise.resolve();

export function getSettings(): Promise<Settings> {
  current ??= load();
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

/** Changes settings the renderer may not set itself (the font list). */
export async function saveTrusted(patch: Partial<Settings>): Promise<Settings> {
  return save(patch);
}

/**
 * Changes are applied one after another: each starts from what the one
 * before it wrote, so two at once can't undo each other.
 */
function save(patch: Partial<Settings>): Promise<Settings> {
  const mine = saving.then(async () => {
    const next = settingsSchema.parse({ ...(await getSettings()), ...patch });
    await writeFileAtomic(settingsFile(), JSON.stringify(next, null, 2));
    current = Promise.resolve(next);
    return next;
  });
  saving = mine.catch(() => undefined);
  return mine;
}

async function load(): Promise<Settings> {
  const defaults = defaultSettings(defaultUiLanguage(app.getLocale()));
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
