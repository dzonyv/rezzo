/**
 * Starts the media worker on first use and forwards calls to it. If the
 * worker dies, pending calls fail and the next call starts a fresh one.
 */
import { utilityProcess, type MessagePortMain, type UtilityProcess } from 'electron';
import workerPath from '../workers/media/index.ts?modulePath';
import { WorkerError, type WorkerMethod, type WorkerMethods, type WorkerReply } from '../shared/worker-api.ts';
import { ffmpegBinDir } from './paths.ts';

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  onProgress?: (progress: unknown) => void;
}

let child: UtilityProcess | undefined;
const pending = new Map<number, Pending>();
let nextId = 1;

function worker(): UtilityProcess {
  if (child) return child;
  const proc = utilityProcess.fork(workerPath, [], {
    serviceName: 'Rezzo media worker',
    env: { ...process.env, REZZO_FFMPEG_DIR: ffmpegBinDir() },
    stdio: 'inherit',
  });
  proc.on('message', (reply: WorkerReply) => {
    const p = pending.get(reply.id);
    if (!p) return;
    if (reply.type === 'progress') {
      p.onProgress?.(reply.progress);
      return;
    }
    pending.delete(reply.id);
    if (reply.type === 'result') p.resolve(reply.value);
    else p.reject(new WorkerError(reply.message, reply.code));
  });
  proc.on('exit', (code) => {
    if (child === proc) child = undefined;
    for (const p of pending.values()) p.reject(new WorkerError(`media worker exited with ${code}`, 'worker-exited'));
    pending.clear();
  });
  child = proc;
  return proc;
}

export interface CallOptions<P = unknown> {
  onProgress?: (progress: P) => void;
  signal?: AbortSignal;
  /** Ports handed to the worker with the call. */
  transfer?: MessagePortMain[];
}

export function callWorker<M extends WorkerMethod>(
  method: M,
  args: Parameters<WorkerMethods[M]>,
  options: CallOptions = {},
): Promise<ReturnType<WorkerMethods[M]>> {
  const proc = worker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress: options.onProgress });
    proc.postMessage({ type: 'call', id, method, args }, options.transfer);
    options.signal?.addEventListener('abort', () => proc.postMessage({ type: 'cancel', id }), { once: true });
  });
}

export function stopWorker(): void {
  child?.kill();
  child = undefined;
}
