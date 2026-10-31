import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareClip } from './clip.ts';
import { cancelExport, openExport, revealExport, startExport } from './export.ts';
import { checkEpisode, chooseEpisode, episodeMediaUrl, importEpisode, locateEpisode, makePreview } from './episode.ts';
import { handleMediaProtocol, registerMediaScheme } from './media-protocol.ts';
import { broadcast, handle, trustPagesFrom } from './ipc.ts';
import {
  autosave, chooseProjectToOpen, chooseWhereToSave, discardRecovery, openProject, recentProjects, recoveredProjects, saveProject,
} from './project-files.ts';
import { getSettings, updateSettings } from './settings.ts';
import { cancelTranscription, startTranscription, transcriptionStatus } from './transcription.ts';
import { stopWorker } from './worker-host.ts';
import { projectSchema } from '../shared/project.ts';

// Tests run the app against a throwaway profile.
const userDataOverride = process.env['REZZO_USER_DATA'];
if (userDataOverride) app.setPath('userData', userDataOverride);

registerMediaScheme();

// One running copy; a second launch focuses the first window instead.
if (!app.requestSingleInstanceLock()) app.quit();

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win?.isMinimized()) win.restore();
  win?.focus();
});

/** Set once the renderer has dealt with unsaved work, so the next close goes through. */
const closeApproved = new WeakSet<BrowserWindow>();

function registerHandlers(): void {
  handle('settings:get', () => getSettings());
  handle('settings:set', async (_ctx, patch) => {
    const settings = await updateSettings(patch);
    broadcast('settings:changed', settings);
    return settings;
  });

  handle('project:choose', ({ window }) => chooseProjectToOpen(window));
  handle('project:open', (_ctx, file) => openProject(String(file)));
  handle('project:save', async ({ window }, project, file) => {
    const valid = projectSchema.parse(project);
    const target = file ?? (await chooseWhereToSave(window, valid.name, valid.source?.path));
    return target ? saveProject(valid, target) : null;
  });
  handle('project:recent', () => recentProjects());
  handle('project:autosave', (_ctx, project, filePath) => autosave(project, filePath));
  handle('project:recovered', () => recoveredProjects());
  handle('project:discard-recovery', (_ctx, id) => discardRecovery(id));

  handle('episode:choose', ({ window }) => chooseEpisode(window));
  handle('episode:import', (_ctx, file) => importEpisode(String(file)));
  handle('episode:check', (_ctx, source) => checkEpisode(source));
  handle('episode:locate', ({ window }, source) => locateEpisode(window, source));
  handle('episode:media-url', (_ctx, source) => episodeMediaUrl(source));
  handle('episode:preview', ({ window }, source) => makePreview(window.webContents, source));

  handle('transcribe:status', () => transcriptionStatus());
  handle('transcribe:start', ({ window }, request) => startTranscription(window.webContents, request));
  handle('transcribe:cancel', () => cancelTranscription());

  handle('clip:prepare', ({ window }, source, range) => prepareClip(window.webContents, source, range));

  handle('export:start', ({ window }, source, clip) => startExport(window, source, clip));
  handle('export:cancel', () => cancelExport());
  handle('export:reveal', () => revealExport());
  handle('export:open', () => openExport());

  handle('app:close', ({ window }) => {
    closeApproved.add(window);
    window.close();
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: '#141417',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win.show());

  // Closing goes through the renderer first: it may have unsaved work to ask about.
  win.on('close', (event) => {
    if (closeApproved.has(win)) return;
    event.preventDefault();
    win.webContents.send('app:close-requested', null);
  });

  // The app never navigates; links to the web open in the default browser.
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // In development electron-vite serves the page; in a build it's a file.
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    win.webContents.on('console-message', ({ level, message }) => {
      if (level === 'warning' || level === 'error') console.log(`[renderer ${level}] ${message}`);
    });
    trustPagesFrom(devUrl);
    void win.loadURL(devUrl);
  } else {
    const page = path.join(__dirname, '../renderer/index.html');
    trustPagesFrom(pathToFileURL(page).href);
    void win.loadFile(page);
  }
}

app.whenReady().then(() => {
  handleMediaProtocol();
  registerHandlers();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => stopWorker());
