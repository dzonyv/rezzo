/**
 * Reading and writing .rezzo files, the recent-projects list, and recovery
 * copies of unsaved work.
 */
import { app, dialog, type BrowserWindow } from 'electron';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { OpenResult, RecentProject, RecoveredProject, SaveResult } from '../shared/api.ts';
import { parseProject, PROJECT_EXTENSION, ProjectFormatError, projectSchema, serializeProject, type Project } from '../shared/project.ts';
import { translate } from '../shared/translate.ts';
import { safeFileName, writeFileAtomic } from '../node/files.ts';
import { hasExtensionOf } from '../shared/assets.ts';
import { isKnownAsset, isKnownSource, rememberAsset, rememberSource } from './media-protocol.ts';
import { getSettings } from './settings.ts';

const recentFile = () => path.join(app.getPath('userData'), 'recent.json');
const recoveryDir = () => path.join(app.getPath('userData'), 'recovery');
const RECENT_LIMIT = 10;

async function filters() {
  const { uiLanguage } = await getSettings();
  return [{ name: translate(uiLanguage, 'files.project'), extensions: [PROJECT_EXTENSION] }];
}

const fileKey = (file: string) => path.resolve(file).toLowerCase();

/**
 * The project files the page may open or save over: the ones the user
 * picked in a dialog, and the ones the app itself wrote or lists (recent
 * projects, the file a recovery copy belongs to). The page is sandboxed so
 * that it can't read or write files of its own choosing; without this list
 * "open this path" and "save to that path" would let it.
 */
const granted = new Set<string>();

function grant(file: string): void {
  granted.add(fileKey(file));
}

async function isGranted(file: string): Promise<boolean> {
  return granted.has(fileKey(file)) || (await readRecent()).some((r) => fileKey(r.path) === fileKey(file));
}

/** Files named in a project the main process read itself. They may be saved again, whether or not they can be read. */
const listed = new Set<string>();

/**
 * Lets the page play the source and read the layers' files of a project
 * the main process read itself. A layer's file has to be named like one of
 * its kind, as every file added through the app is.
 */
function rememberFiles(project: Project): void {
  if (project.source) {
    rememberSource(project.source.path);
    listed.add(fileKey(project.source.path));
  }
  for (const asset of project.assets) {
    if (hasExtensionOf(asset.kind, asset.path)) rememberAsset(asset.path);
    listed.add(fileKey(asset.path));
  }
}

/**
 * A project the page hands over to be written may only name files the app
 * gave it: picked in a dialog, imported, or named in a project the main
 * process opened. Otherwise the page could write a project naming any file
 * on the disk, open it again and be let to read that file.
 */
function assertOwnFiles(project: Project): void {
  const strange = [
    ...(project.source && !isKnownSource(project.source.path) ? [project.source.path] : []),
    ...project.assets.filter((a) => !isKnownAsset(a.path)).map((a) => a.path),
  ].filter((file) => !listed.has(fileKey(file)));
  if (strange.length > 0) throw new Error(`The project names files the app never opened: ${strange.join(', ')}`);
}

export async function chooseProjectToOpen(win: BrowserWindow): Promise<string | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: await filters(),
  });
  const file = canceled ? null : (filePaths[0] ?? null);
  if (file) grant(file);
  return file;
}

export async function chooseWhereToSave(win: BrowserWindow, suggestedName: string, nextTo?: string): Promise<string | null> {
  const name = safeFileName(suggestedName, PROJECT_EXTENSION, 'project');
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: nextTo ? path.join(path.dirname(nextTo), name) : name,
    filters: await filters(),
  });
  if (canceled || !filePath) return null;
  grant(filePath);
  return filePath;
}

export async function openProject(file: string): Promise<OpenResult> {
  if (!(await isGranted(file))) throw new Error('Not a project file the user chose');
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    const error = (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'not-found' : 'unreadable';
    return { ok: false, path: file, error };
  }
  try {
    const project = parseProject(text);
    rememberFiles(project);
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
  if (!(await isGranted(file))) throw new Error('Not a project file the user chose');
  const valid = projectSchema.parse(project);
  assertOwnFiles(valid);
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

const recoverySchema = z.object({
  filePath: z.string().nullable(),
  /** Set by versions that only write a copy for a file the user chose. */
  pathChecked: z.boolean().optional(),
  savedAt: z.string(),
  project: z.unknown(),
});
const recoveryFile = (id: string) => path.join(recoveryDir(), `${id}.json`);

/** Keeps a copy of unsaved work so a crash doesn't lose it. */
export async function autosave(project: unknown, filePath: string | null): Promise<void> {
  const valid = projectSchema.parse(project);
  // A recovery copy is opened again like a project, and is later saved to the file it names.
  assertOwnFiles(valid);
  if (filePath !== null && !(await isGranted(filePath))) throw new Error('Not a project file the user chose');
  await mkdir(recoveryDir(), { recursive: true });
  const copy: z.infer<typeof recoverySchema> = { filePath, pathChecked: true, savedAt: new Date().toISOString(), project: valid };
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
      // Through the upgrades: a copy from before an update is still someone's work.
      const project = parseProject(JSON.stringify(copy.project));
      rememberFiles(project);
      // A copy from before paths were checked comes back as a project never saved, and asks where to save.
      const filePath = copy.pathChecked ? copy.filePath : null;
      if (filePath) grant(filePath);
      found.push({ filePath, savedAt: copy.savedAt, project });
    } catch {
      // A half-written copy, or one from a newer version; nothing to offer.
    }
  }
  return found.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

