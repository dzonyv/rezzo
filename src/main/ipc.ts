import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { EventApi, EventChannel, InvokeArgs, InvokeChannel, InvokeResult } from '../shared/api.ts';

/** URL prefix of our own pages; set once the window knows where it loads from. */
let trustedOrigin: string | undefined;

export function trustPagesFrom(urlPrefix: string): void {
  trustedOrigin = urlPrefix;
}

function assertTrusted(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? '';
  if (!trustedOrigin || !url.startsWith(trustedOrigin)) {
    throw new Error(`IPC from an untrusted page: ${url}`);
  }
}

export interface HandlerContext {
  /** The window the call came from. */
  window: BrowserWindow;
}

/**
 * Registers the handler for one invoke channel. Arguments come from the
 * renderer, so handlers validate them before use.
 */
export function handle<C extends InvokeChannel>(
  channel: C,
  handler: (context: HandlerContext, ...args: InvokeArgs<C>) => InvokeResult<C> | Promise<InvokeResult<C>>,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrusted(event);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error('IPC from a page without a window');
    return handler({ window }, ...(args as InvokeArgs<C>));
  });
}

/** Sends an event to every window. */
export function broadcast<C extends EventChannel>(channel: C, payload: EventApi[C]): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}
