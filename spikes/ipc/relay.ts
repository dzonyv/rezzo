/**
 * Dedicated Web Worker that owns the MessagePort to the utility process.
 * Frames arrive from the page as transferred buffers (no copy); posting them
 * on the Electron port copies them here, off the page's thread, and the
 * buffer then goes back to the page for reuse.
 */
let port: MessagePort | undefined;
// The project's lib is DOM, not WebWorker; this is the worker's postMessage.
const post = postMessage as unknown as (message: unknown, transfer?: Transferable[]) => void;

self.onmessage = (e: MessageEvent) => {
  if (e.data.type === 'port') {
    port = e.ports[0];
    port.onmessage = (r) => post({ type: 'reply', reply: r.data });
    return;
  }
  const { message } = e.data as { message: { type: string; data?: Uint8Array } };
  port!.postMessage(message);
  if (message.data) post({ type: 'recycle', data: message.data }, [message.data.buffer]);
};
