/**
 * Saving a clip's cover. The page draws and encodes the picture
 * (renderer/src/cover/save-cover.ts); the main process asks where it goes
 * and writes it.
 */
import { app, dialog, shell, type BrowserWindow } from 'electron';
import path from 'node:path';
import { z } from 'zod';
import { COVER_FORMATS, MAX_JPG_BYTES, type CoverFormat } from '../shared/cover.ts';
import { translate } from '../shared/translate.ts';
import { safeFileName, writeFileAtomic } from '../node/files.ts';
import { getSettings, rememberExportDir } from './settings.ts';

/** A PNG of 1080×1920 is well under this; anything bigger isn't a cover. */
const MAX_PNG_BYTES = 64 * 1024 * 1024;

/** The last cover written; the only one the page may ask to show. */
let lastCover: string | undefined;

export async function saveCover(win: BrowserWindow, nameArg: unknown, formatArg: unknown, bytesArg: unknown): Promise<string | null> {
  const clipName = z.string().parse(nameArg);
  const format: CoverFormat = z.enum(COVER_FORMATS).parse(formatArg);
  const bytes = z.instanceof(Uint8Array).parse(bytesArg);
  if (bytes.length === 0 || bytes.length > (format === 'jpg' ? MAX_JPG_BYTES : MAX_PNG_BYTES)) throw new Error(`a ${format} cover of ${bytes.length} bytes`);

  const { uiLanguage, exportDir } = await getSettings();
  const name = safeFileName(clipName, format, translate(uiLanguage, 'clips.untitled'));
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(exportDir ?? app.getPath('pictures'), name),
    filters: [{ name: translate(uiLanguage, `files.${format}`), extensions: [format] }],
  });
  if (canceled || !filePath) return null;
  await writeFileAtomic(filePath, bytes);
  await rememberExportDir(path.dirname(filePath));
  lastCover = filePath;
  return filePath;
}

export function revealCover(): void {
  if (lastCover) shell.showItemInFolder(lastCover);
}
