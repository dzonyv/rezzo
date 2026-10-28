/**
 * Electron main process shared by the spike labs. Opens one window, forwards the
 * renderer's console to stdout and quits when the renderer reports it's done.
 *
 * Node integration is on in the renderer so it can spawn FFmpeg and write
 * files directly. That's fine for a spike; the real app will keep the renderer
 * sandboxed and move this work to a utility process.
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';

app.commandLine.appendSwitch('ignore-gpu-blocklist');

// Everything after the entry script that looks like --name=value goes to the renderer.
const labArgs = process.argv.slice(2).filter((a) => /^--[a-z]+=/.test(a));

app.whenReady().then(async () => {
  const gpu = await app.getGPUInfo('basic');

  const win = new BrowserWindow({
    width: 560,
    height: 1040,
    title: 'Rezzo export lab',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  win.webContents.on('console-message', (event) => {
    const { level, message } = event as unknown as { level: string; message: string };
    (level === 'error' ? process.stderr : process.stdout).write(`${message}\n`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('renderer gone:', details.reason);
    app.exit(2);
  });

  ipcMain.handle('gpu-info', () => gpu);
  ipcMain.on('done', (_e, code: number) => app.exit(code));

  await win.loadFile(path.join(__dirname, 'index.html'), { query: { args: labArgs.join(' ') } });
});
