/**
 * What the page may ask of project files: only the files the user chose,
 * and only projects naming files the app gave it. The page here is one
 * that asks for more than it should.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageAsset } from '../shared/assets.ts';
import { newProject, serializeProject, type Project } from '../shared/project.ts';

let dir: string;
/** What the next open or save dialog answers. */
let picked: string | null = null;
vi.mock('electron', () => ({
  app: { getPath: () => path.join(dir, 'profile'), getLocale: () => 'en-US' },
  dialog: {
    showOpenDialog: async () => ({ canceled: picked === null, filePaths: picked ? [picked] : [] }),
    showSaveDialog: async () => ({ canceled: picked === null, filePath: picked ?? undefined }),
  },
  protocol: {},
}));

type Files = typeof import('./project-files.ts');
type Media = typeof import('./media-protocol.ts');
let files: Files;
let media: Media;
const win = {} as Parameters<Files['chooseProjectToOpen']>[0];

const image = (file: string): ImageAsset => ({
  id: crypto.randomUUID(),
  kind: 'image',
  path: file,
  name: path.basename(file),
  size: 1,
  fingerprint: 'c'.repeat(64),
  width: 10,
  height: 10,
});
const withAsset = (file: string): Project => ({ ...newProject('p'), assets: [image(file)] });

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-projects-'));
  // Electron makes the profile folder itself.
  await mkdir(path.join(dir, 'profile'));
  picked = null;
  // A fresh main process each time: nothing chosen, nothing known.
  vi.resetModules();
  files = await import('./project-files.ts');
  media = await import('./media-protocol.ts');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('project files', () => {
  it('saves where the user chose, and opens that file again', async () => {
    picked = path.join(dir, 'a.rezzo');
    const target = (await files.chooseWhereToSave(win, 'a'))!;
    const project = newProject('a');
    expect(await files.saveProject(project, target)).toEqual({ ok: true, path: target });
    expect(await files.openProject(target)).toMatchObject({ ok: true, project: { id: project.id } });
  });

  it('opens a recent project after a restart', async () => {
    picked = path.join(dir, 'a.rezzo');
    await files.saveProject(newProject('a'), (await files.chooseWhereToSave(win, 'a'))!);
    vi.resetModules();
    files = await import('./project-files.ts');
    expect(await files.openProject(picked)).toMatchObject({ ok: true });
  });

  it('refuses to open or save a path nobody chose', async () => {
    const file = path.join(dir, 'elsewhere.rezzo');
    await writeFile(file, serializeProject(newProject('x')));
    await expect(files.openProject(file)).rejects.toThrow('user chose');
    await expect(files.saveProject(newProject('x'), file)).rejects.toThrow('user chose');
    await expect(files.autosave(newProject('x'), file)).rejects.toThrow('user chose');
  });

  it("refuses to write a project naming a file the app never gave the page, so opening it can't hand that file out", async () => {
    const secret = path.join(dir, 'secret.png');
    picked = path.join(dir, 'a.rezzo');
    const target = (await files.chooseWhereToSave(win, 'a'))!;
    await expect(files.saveProject(withAsset(secret), target)).rejects.toThrow('never opened');
    await expect(files.autosave(withAsset(secret), null)).rejects.toThrow('never opened');
    expect(await files.recoveredProjects()).toEqual([]);
    expect(() => media.assetUrl(secret)).toThrow();
  });

  it('writes a project naming files that were picked, or that came with a project it opened', async () => {
    const logo = path.join(dir, 'logo.png');
    picked = path.join(dir, 'a.rezzo');
    const target = (await files.chooseWhereToSave(win, 'a'))!;
    media.rememberAsset(logo);
    const project = withAsset(logo);
    expect(await files.saveProject(project, target)).toMatchObject({ ok: true });

    // After a restart the file is known again from the project itself.
    vi.resetModules();
    files = await import('./project-files.ts');
    media = await import('./media-protocol.ts');
    expect(await files.openProject(target)).toMatchObject({ ok: true });
    expect(media.assetUrl(logo)).toContain('rezzo-media://');
    expect(await files.saveProject(project, target)).toMatchObject({ ok: true });
    await files.autosave(project, target);
    expect(await files.recoveredProjects()).toMatchObject([{ filePath: target }]);
  });

  it("doesn't hand out a layer's file that isn't named like one of its kind, but keeps it in the project", async () => {
    const odd = path.join(dir, 'passwords.txt');
    picked = path.join(dir, 'handmade.rezzo');
    await writeFile(picked, serializeProject(withAsset(odd)));
    const opened = await files.openProject((await files.chooseProjectToOpen(win))!);
    expect(opened.ok).toBe(true);
    expect(() => media.assetUrl(odd)).toThrow();
    // Saving the project as it was opened still works.
    if (opened.ok) expect(await files.saveProject(opened.project, picked)).toMatchObject({ ok: true });
  });
});
