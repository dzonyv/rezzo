import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { addAsset, assetFileUrl, checkAsset, locateAsset } from './assets.ts';
import { cancelPrepare, prepareClip } from './clip.ts';
import { clearStorage, revealStorage, storageUsage } from './storage.ts';
import { cancelOverlay, prepareOverlay } from './overlay.ts';
import { revealCover, saveCover } from './cover.ts';
import { cancelExport, openExport, revealExport, startExport } from './export.ts';
import { addFont, readCustomFont } from './fonts.ts';
import { librarySoundUrl } from './sounds.ts';
import { assetLoudness, clipLevels, clipLoudness } from './loudness.ts';
import { checkEpisode, chooseEpisode, episodeMediaUrl, episodeThumbnail, importEpisode, locateEpisode, makePreview, stopEpisodeWork } from './episode.ts';
import { handleMediaProtocol, registerMediaScheme } from './media-protocol.ts';
import { broadcast, handle, trustPagesFrom } from './ipc.ts';
import {
  autosave, chooseProjectToOpen, chooseWhereToSave, discardRecovery, openProject, recentProjects, recoveredProjects, saveProject,
} from './project-files.ts';
import { getSettings, updateSettings } from './settings.ts';
import { cancelTranscription, startTranscription, transcriptionStatus } from './transcription.ts';
import { analysisModels, loadAnalysis, saveAnalysis } from './analysis.ts';
import { cancelVoices, startVoices } from './voices.ts';
import { stopWorker } from './worker-host.ts';
import { errorText, log, logStart, revealLog } from './log.ts';
import { projectSchema } from '../shared/project.ts';

/**
 * The licenses next to the app (electron-builder copies them to
 * resources/licenses), so they match this version and work offline. With no
 * program for .md files, the same file on GitHub.
 */
async function openLicenses(): Promise<void> {
  const file = app.isPackaged
    ? path.join(process.resourcesPath, 'licenses', 'THIRD_PARTY_NOTICES.md')
    : path.join(__dirname, '..', '..', 'THIRD_PARTY_NOTICES.md');
  const failed = await shell.openPath(file);
  if (failed) await shell.openExternal('https://github.com/dzonyv/rezzo/blob/main/THIRD_PARTY_NOTICES.md');
}

// Tests run the app against a throwaway profile.
const userDataOverride = process.env['REZZO_USER_DATA'];
if (userDataOverride) app.setPath('userData', userDataOverride);

// Written down before Electron deals with it as usual (its dialog, or a rejection turned into one).
process.on('uncaughtExceptionMonitor', (e) => log('error', 'main', errorText(e)));
// Electron only warns about these in a console nobody sees; Node's warning is kept.
process.on('unhandledRejection', (reason) => {
  log('error', 'main', `unhandled rejection: ${errorText(reason)}`);
  console.warn('Unhandled rejection in the main process:', reason);
});
// The media worker is a utility process too; worker-host.ts logs it, knowing when it was stopped on purpose.
app.on('child-process-gone', (_event, d) => {
  if (d.reason !== 'clean-exit' && d.type !== 'Utility') log('error', 'app', `${d.type} process gone: ${d.reason} (exit code ${d.exitCode})`);
});

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
/** Windows whose renderer hears close requests. Before that a request would be lost, and there's no work to lose. */
const closeListening = new WeakSet<BrowserWindow>();

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
  handle('episode:thumbnail', (_ctx, source, time, size) => episodeThumbnail(source, time, size));
  handle('episode:stop', (_ctx, fingerprint) => stopEpisodeWork(fingerprint));

  handle('transcribe:status', () => transcriptionStatus());
  handle('transcribe:start', ({ window }, request) => startTranscription(window.webContents, request));
  handle('transcribe:cancel', () => cancelTranscription());

  handle('voices:start', ({ window }, request) => startVoices(window.webContents, request));
  handle('voices:cancel', () => cancelVoices());

  handle('clip:prepare', ({ window }, source, range) => prepareClip(window.webContents, source, range));
  handle('clip:cancel', ({ window }) => cancelPrepare(window.webContents));
  handle('overlay:prepare', ({ window }, asset, range, rate, requestId) => prepareOverlay(window.webContents, asset, range, rate, requestId));
  handle('overlay:cancel', (_ctx, requestId) => cancelOverlay(requestId));

  handle('analysis:models', () => analysisModels());
  handle('analysis:load', (_ctx, url) => loadAnalysis(url));
  handle('analysis:save', (_ctx, url, analysis) => saveAnalysis(url, analysis));

  handle('export:start', ({ window }, source, clip, assets) => startExport(window, source, clip, assets));
  handle('export:cancel', () => cancelExport());
  handle('export:reveal', () => revealExport());
  handle('export:open', () => openExport());
  handle('cover:save', ({ window }, name, format, bytes) => saveCover(window, name, format, bytes));
  handle('cover:reveal', () => revealCover());

  handle('app:licenses', () => openLicenses());
  handle('app:log-folder', () => revealLog());
  handle('storage:usage', () => storageUsage());
  handle('storage:clear', (_ctx, what) => clearStorage(what));
  handle('storage:reveal', () => revealStorage());

  handle('fonts:add', ({ window }) => addFont(window));
  handle('fonts:read', (_ctx, file) => readCustomFont(file));

  handle('asset:add', ({ window }, kind) => addAsset(window, kind));
  handle('asset:check', (_ctx, asset) => checkAsset(asset));
  handle('asset:locate', ({ window }, kind, asset) => locateAsset(window, kind, asset));
  handle('asset:url', (_ctx, asset) => assetFileUrl(asset));
  handle('sound:url', (_ctx, name) => librarySoundUrl(name));
  handle('loudness:clip', (_ctx, source, clip) => clipLoudness(source, clip));
  handle('loudness:asset', (_ctx, asset) => assetLoudness(asset));
  handle('loudness:levels', (_ctx, source, clip) => clipLevels(source, clip));

  handle('app:listening', ({ window }) => void closeListening.add(window));
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
  // In development electron-vite serves the page; in a build it's a file.
  const devUrl = process.env['ELECTRON_RENDERER_URL'];

  // Closing goes through the renderer first: it may have unsaved work to ask about.
  win.on('close', (event) => {
    if (closeApproved.has(win) || !closeListening.has(win)) return;
    event.preventDefault();
    win.webContents.send('app:close-requested', null);
  });
  // Nobody hears a request after a crash, or from a reloaded page until it says so.
  win.webContents.on('render-process-gone', (_event, d) => {
    closeListening.delete(win);
    log('error', 'page', `gone: ${d.reason} (exit code ${d.exitCode})`);
  });
  // The page's warnings and errors, uncaught ones included, go to the log; in development to the terminal too.
  win.webContents.on('console-message', ({ level, message, sourceId, lineNumber }) => {
    if (level !== 'warning' && level !== 'error') return;
    log(level === 'error' ? 'error' : 'warn', 'page', sourceId ? `${message} (${path.basename(sourceId)}:${lineNumber})` : message);
    if (devUrl) console.log(`[renderer ${level}] ${message}`);
  });
  win.webContents.on('did-navigate', () => closeListening.delete(win));

  // The app never navigates; links to the web open in the default browser.
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (devUrl) {
    trustPagesFrom(devUrl);
    void win.loadURL(devUrl);
  } else {
    const page = path.join(__dirname, '../renderer/index.html');
    trustPagesFrom(pathToFileURL(page).href);
    void win.loadFile(page);
  }
}

app.whenReady().then(() => {
  logStart();
  handleMediaProtocol();
  registerHandlers();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => stopWorker());
