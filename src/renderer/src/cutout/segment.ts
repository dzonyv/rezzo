/**
 * The page's side of cutout.worker.ts: one worker for the session, started
 * the first time a cover has a cutout, its model loaded once.
 */
import wasmBinary from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import wasmLoader from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import type { CutoutReply, CutoutRequest } from './cutout-messages.ts';

/** How sure the segmenter is that each pixel is a person, 0..255, top row first. */
export interface PeopleMask {
  data: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
}

/** Pictures sent to the worker and not answered yet, by request id. */
const pending = new Map<number, { resolve(mask: PeopleMask): void; reject(error: Error): void }>();
let nextId = 0;
let worker: Promise<Worker> | undefined;

/** Everything waiting fails, and the next picture starts a fresh worker. */
function workerFailed(w: Worker, error: Error): void {
  w.terminate();
  worker = undefined;
  for (const p of pending.values()) p.reject(error);
  pending.clear();
}

function cutoutWorker(): Promise<Worker> {
  worker ??= (async () => {
    const { segmenter } = await window.rezzo.invoke('analysis:models');
    const model = await (await fetch(segmenter)).arrayBuffer();
    // A classic worker, as for the people analysis: MediaPipe loads its WASM glue with importScripts.
    const w = new Worker(new URL('./cutout.worker.ts', import.meta.url), { type: 'classic' });
    const init: CutoutRequest = {
      type: 'init',
      wasmLoader: new URL(wasmLoader, document.baseURI).href,
      wasmBinary: new URL(wasmBinary, document.baseURI).href,
      model,
    };
    const ready = await new Promise<CutoutReply>((resolve) => {
      w.onmessage = (e: MessageEvent<CutoutReply>) => resolve(e.data);
      w.onerror = (e) => resolve({ type: 'error', message: e.message || 'the cutout worker stopped' });
      w.postMessage(init, [model]);
    });
    if (ready.type !== 'ready') {
      w.terminate();
      throw new Error(ready.type === 'error' ? ready.message : 'MediaPipe did not start');
    }
    w.onmessage = (e: MessageEvent<CutoutReply>) => {
      const r = e.data;
      if (r.type === 'mask') {
        pending.get(r.id)?.resolve({ data: r.data, width: r.width, height: r.height });
        pending.delete(r.id);
      } else if (r.type === 'error' && r.id !== undefined) {
        pending.get(r.id)?.reject(new Error(r.message));
        pending.delete(r.id);
      } else if (r.type === 'error') {
        workerFailed(w, new Error(r.message));
      }
    };
    // A crash (WASM abort, GPU process gone) answers nothing; don't leave anyone waiting.
    w.onerror = (e) => workerFailed(w, new Error(e.message || 'the cutout worker stopped'));
    w.onmessageerror = () => workerFailed(w, new Error('the cutout worker sent something unreadable'));
    return w;
  })();
  // A worker that didn't start is tried again next time.
  worker.catch(() => (worker = undefined));
  return worker;
}

/** The people in a picture (RGBA, top row first, `width` × `height`). */
export async function findPeople(pixels: Uint8ClampedArray<ArrayBuffer>, width: number, height: number): Promise<PeopleMask> {
  const w = await cutoutWorker();
  const id = nextId++;
  return new Promise<PeopleMask>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const msg: CutoutRequest = { type: 'segment', id, pixels, width, height };
    w.postMessage(msg, [pixels.buffer]);
  });
}
