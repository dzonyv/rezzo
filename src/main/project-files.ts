/**
 * Reading and writing .rezzo files, the recent-projects list, and recovery
 * copies of unsaved work.
 */
import { app, dialog, type BrowserWindow } from 'electron';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { OpenResult, RecentProject, RecoveredProject, SaveResult } from '../shared/api.ts';
import { parseProject, PROJECT_EXTENSION, ProjectFormatError, projectSchema, serializeProject } from '../shared/project.ts';
import { translate } from '../shared/translate.ts';
import { writeFileAtomic } from './files.ts';
import { getSettings } from './settings.ts';

const recentFile = () => path.join(app.getPath('userData'), 'recent.json');
const recoveryDir = () => path.join(app.getPath('userData'), 'recovery');
const RECENT_LIMIT = 10;

async function filters() {
  const { uiLanguage } = await getSettings();
  return [{ name: translate(uiLanguage, 'files.project'), extensions: [PROJECT_EXTENSION] }];
}

export async function chooseProjectToOpen(win: BrowserWindow): Promise<string | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: await filters(),
  });
  return canceled ? null : (filePaths[0] ?? null);
}

export async function chooseWhereToSave(win: BrowserWindow, suggestedName: string, nextTo?: string): Promise<string | null> {
  const name = `${suggestedName.replace(/[<>:"/\\|?*]/g, '_').trim() || 'project'}.${PROJECT_EXTENSION}`;
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: nextTo ? path.join(path.dirname(nextTo), name) : name,
    filters: await filters(),
  });
  return canceled || !filePath ? null : filePath;
}

export async function openProject(file: string): Promise<OpenResult> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    const error = (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'not-found' : 'unreadable';
    return { ok: false, path: file, error };
  }
  try {
    const project = parseProject(text);
    await remember(file, project.name);
    return { ok: true, path: file, project };
  } catch (e) {
    if (e instanceof ProjectFormatError) return { ok: false, path: file, error: e.code };
    throw e;
  }
}

export async function saveProject(project: unknown, file: string): Promise<SaveResult> {
  if (path.extname(file).toLowerCase() !== `.${PROJECT_EXTENSION}`) {
    return { ok: false, error: 'write-failed', detail: `not a .${PROJECT_EXTENSION} file` };
  }
  const valid = projectSchema.parse(project);
  try {
    await writeFileAtomic(file, serializeProject(valid));
  } catch (e) {
    return { ok: false, error: 'write-failed', detail: String(e) };
  }
  await remember(file, valid.name);
  await discardRecovery(valid.id);
  return { ok: true, path: file };
}

const recentSchema = z.array(z.object({ path: z.string(), name: z.string(), openedAt: z.string() }));

async function readRecent(): Promise<z.infer<typeof recentSchema>> {
  try {
    return recentSchema.parse(JSON.parse(await readFile(recentFile(), 'utf8')));
  } catch {
    return [];
  }
}

async function remember(file: string, name: string): Promise<void> {
  const others = (await readRecent()).filter((r) => path.resolve(r.path) !== path.resolve(file));
  const list = [{ path: file, name, openedAt: new Date().toISOString() }, ...others].slice(0, RECENT_LIMIT);
  await writeFileAtomic(recentFile(), JSON.stringify(list, null, 2));
}

export async function recentProjects(): Promise<RecentProject[]> {
  return readRecent();
}

const recoverySchema = z.object({ filePath: z.string().nullable(), savedAt: z.string(), project: z.unknown() });
const recoveryFile = (id: string) => path.join(recoveryDir(), `${id}.json`);

/** Keeps a copy of unsaved work so a crash doesn't lose it. */
export async function autosave(project: unknown, filePath: string | null): Promise<void> {
  const valid = projectSchema.parse(project);
  await mkdir(recoveryDir(), { recursive: true });
  const copy = { filePath, savedAt: new Date().toISOString(), project: valid };
  await writeFileAtomic(recoveryFile(valid.id), JSON.stringify(copy));
}

export async function discardRecovery(id: string): Promise<void> {
  if (!z.uuid().safeParse(id).success) return;
  await rm(recoveryFile(id), { force: true });
}

/** Unsaved work left behind by a crash. Damaged copies are skipped. */
export async function recoveredProjects(): Promise<RecoveredProject[]> {
  let names: string[];
  try {
    names = await readdir(recoveryDir());
  } catch {
    return [];
  }
  const found: RecoveredProject[] = [];
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    try {
      const copy = recoverySchema.parse(JSON.parse(await readFile(path.join(recoveryDir(), name), 'utf8')));
      found.push({ filePath: copy.filePath, savedAt: copy.savedAt, project: projectSchema.parse(copy.project) });
    } catch {
      // A half-written or outdated copy; nothing to offer.
    }
  }
  return found.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

