/**
 * The only bridge between the sandboxed page and the rest of the app.
 * A MessagePort can't cross contextBridge, so it is handed to the page with
 * window.postMessage, as the Electron docs recommend.
 */
import { contextBridge, ipcRenderer } from 'electron';

ipcRenderer.on('lab:port', (event) => window.postMessage('lab:port', '*', event.ports));

contextBridge.exposeInMainWorld('lab', {
  args: (): Promise<{ args: string[]; mediaDir: string }> => ipcRenderer.invoke('lab:args'),
  result: (key: string, value: unknown): Promise<void> => ipcRenderer.invoke('lab:result', key, value),
  done: (code: number): void => ipcRenderer.send('lab:done', code),
});
