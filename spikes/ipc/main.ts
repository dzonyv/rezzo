/**
 * IPC lab, main process. Unlike the Phase 0 labs the renderer is sandboxed
 * and has no Node: it gets files through a `media://` protocol and hands
 * rendered frames to a utility process over a MessagePort. The utility
 * process owns FFmpeg. This is the layout the app will use; the lab measures
 * what it costs.
 */
import { app, BrowserWindow, ipcMain, MessageChannelMain, net, protocol, utilityProcess } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mediaDir } from '../shared/paths.ts';

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);
app.commandLine.appendSwitch('ignore-gpu-blocklist');

const labArgs = process.argv.slice(2).filter((a) => /^--[a-z]+=/.test(a));
const resultsPath = path.join(mediaDir, 'ipc', 'results.json');

app.whenReady().then(async () => {
  protocol.handle('media', async (req) => {
    const file = new URL(req.url).searchParams.get('path');
    if (!file) return new Response('missing path', { status: 400 });
    // The page is a file:// origin, so the response needs a CORS header.
    const res = await net.fetch(pathToFileURL(file).href);
    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(res.body, { status: res.status, headers });
  });

  const worker = utilityProcess.fork(path.join(__dirname, 'worker.cjs'), [], {
    serviceName: 'rezzo-ipc-worker',
    stdio: 'inherit',
  });

  const win = new BrowserWindow({
    width: 560,
    height: 1040,
    title: 'Rezzo IPC lab',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
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

  ipcMain.handle('lab:args', () => ({ args: labArgs, mediaDir }));
  ipcMain.handle('lab:result', async (_e, key: string, value: unknown) => {
    await mkdir(path.dirname(resultsPath), { recursive: true });
    const all = await readFile(resultsPath, 'utf8').then(JSON.parse, () => ({}));
    all[key] = value;
    await writeFile(resultsPath, JSON.stringify(all, null, 2));
  });
  ipcMain.on('lab:done', (_e, code: number) => {
    worker.kill();
    app.exit(code);
  });

  await win.loadFile(path.join(__dirname, 'index.html'));

  const { port1, port2 } = new MessageChannelMain();
  worker.postMessage(null, [port2]);
  win.webContents.postMessage('lab:port', null, [port1]);
});
