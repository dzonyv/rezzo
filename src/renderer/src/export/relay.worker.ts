/**
 * Owns the export's MessagePort to the media worker. Posting a frame on
 * that port copies it into the other process (an Electron port can't
 * transfer buffers), which takes ~4 ms per frame; doing it here instead of
 * on the page keeps that copy off the thread that renders (Phase 1 checks
 * in spikes/REPORT.md). The page hands frames over without a copy, and
 * each buffer comes back for reuse once it has been posted.
 */
import type { ExportPortRequest } from '../../../shared/worker-api.ts';

// The renderer's types are the page's; this is a dedicated worker's scope.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  close(): void;
};

let port: MessagePort | undefined;

scope.onmessage = (e) => {
  const msg = e.data as { type: 'port' } | ExportPortRequest;
  if (msg.type === 'port') {
    port = e.ports[0];
    if (port) port.onmessage = (r) => scope.postMessage(r.data);
    return;
  }
  port?.postMessage(msg);
  if (msg.type === 'frame') {
    scope.postMessage({ type: 'recycle', data: msg.data }, [msg.data.buffer]);
  } else {
    // "end" or "fail": nothing more goes to the encoder.
    port?.close();
    scope.close();
  }
};
