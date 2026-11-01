/**
 * Fonts the user adds for captions. The file is checked, copied into the
 * app's fonts folder under its checksum and listed in the settings; the
 * page asks for its bytes by that name, never by a path.
 */
import { app, dialog, type BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { AddFontResult } from '../shared/api.ts';
import { BCS_LETTERS, FontFileError, missingLetters, readFont } from '../shared/font-file.ts';
import { BUNDLED_FONTS, customFontSchema, type CustomFont } from '../shared/fonts.ts';
import { translate } from '../shared/translate.ts';
import { writeFileAtomic } from '../node/files.ts';
import { broadcast } from './ipc.ts';
import { getSettings, saveTrusted } from './settings.ts';

/** Larger than any real font; keeps a mistaken pick from being read into memory. */
const MAX_FONT_BYTES = 50 * 1024 * 1024;

const fontsDir = () => path.join(app.getPath('userData'), 'fonts');

async function chooseFontFile(win: BrowserWindow): Promise<string | null> {
  const { uiLanguage } = await getSettings();
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: translate(uiLanguage, 'files.font'), extensions: ['ttf', 'otf'] }],
  });
  return canceled ? null : (filePaths[0] ?? null);
}

export async function addFont(win: BrowserWindow): Promise<AddFontResult | null> {
  const file = await chooseFontFile(win);
  if (!file) return null;
  const extension = path.extname(file).slice(1).toLowerCase();
  if (extension !== 'ttf' && extension !== 'otf') return { ok: false, error: 'unreadable' };
  let bytes: Uint8Array;
  let info: ReturnType<typeof readFont>;
  try {
    if ((await stat(file)).size > MAX_FONT_BYTES) return { ok: false, error: 'unreadable' };
    bytes = await readFile(file);
    info = readFont(bytes);
  } catch (e) {
    if (e instanceof FontFileError || (e as NodeJS.ErrnoException).code) return { ok: false, error: 'unreadable' };
    throw e;
  }
  if (BUNDLED_FONTS.some((f) => f.family === info.family)) return { ok: false, error: 'built-in', family: info.family };

  const name = `${createHash('sha256').update(bytes).digest('hex')}.${extension}`;
  await mkdir(fontsDir(), { recursive: true });
  await writeFileAtomic(path.join(fontsDir(), name), bytes);
  const font: CustomFont = { family: info.family, weight: Math.min(900, Math.max(100, Math.round(info.weight / 100) * 100)), file: name };
  // A newer file for the same family and weight takes the old one's place.
  const { fonts } = await getSettings();
  const settings = await saveTrusted({ fonts: [...fonts.filter((f) => f.family !== font.family || f.weight !== font.weight), font] });
  broadcast('settings:changed', settings);
  return { ok: true, font, missing: missingLetters(info, BCS_LETTERS) };
}

/** The bytes of a font the user added, by its name in the settings. */
export async function readCustomFont(file: unknown): Promise<Uint8Array> {
  const name = customFontSchema.shape.file.parse(file);
  const { fonts } = await getSettings();
  if (!fonts.some((f) => f.file === name)) throw new Error(`not an added font: ${name}`);
  return readFile(path.join(fontsDir(), name));
}
