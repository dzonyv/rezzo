import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { broadcast, handle, trustPagesFrom } from './ipc.ts';
import { getSettings, updateSettings } from './settings.ts';

// Tests run the app against a throwaway profile.
const userDataOverride = process.env['REZZO_USER_DATA'];
if (userDataOverride) app.setPath('userData', userDataOverride);

// One running copy; a second launch focuses the first window instead.
if (!app.requestSingleInstanceLock()) app.quit();

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win?.isMinimized()) win.restore();
  win?.focus();
});

function registerHandlers(): void {
  handle('settings:get', () => getSettings());
  handle('settings:set', async (patch) => {
    const settings = await updateSettings(patch);
    broadcast('settings:changed', settings);
    return settings;
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
  registerHandlers();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
