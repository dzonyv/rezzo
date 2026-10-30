/**
 * Runs before the page, in the sandbox. Exposes `window.rezzo`, the page's
 * only way to reach the main process, limited to the channels in shared/api.ts.
 */
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { EVENT_CHANNELS, EXPORT_PORT_MESSAGE, INVOKE_CHANNELS, type RezzoApi } from '../shared/api.ts';

const api: RezzoApi = {
  invoke(channel, ...args) {
    if (!Object.hasOwn(INVOKE_CHANNELS, channel)) throw new Error(`Unknown channel: ${channel}`);
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, listener) {
    if (!Object.hasOwn(EVENT_CHANNELS, channel)) throw new Error(`Unknown channel: ${channel}`);
    const handler = (_event: IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld('rezzo', api);

// A MessagePort can't cross the context bridge; the page gets the export's
// port to the encoder as a window message instead, as Electron's docs suggest.
// (The preload is built without DOM types.)
const page = globalThis as unknown as { postMessage(message: unknown, targetOrigin: string, transfer: unknown[]): void };
ipcRenderer.on(EXPORT_PORT_MESSAGE, (event, job) => page.postMessage({ type: EXPORT_PORT_MESSAGE, job }, '*', event.ports));
