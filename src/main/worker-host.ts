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

/** Reading a file's streams or fingerprint takes a second or two; this long means the file stopped answering. */
export const READ_TIMEOUT_MS = 60_000;

export interface CallOptions<P = unknown> {
  onProgress?: (progress: P) => void;
  signal?: AbortSignal;
  /** Ports handed to the worker with the call. */
  transfer?: MessagePortMain[];
  /**
   * For a job that should be quick and could hang (a file on a network
   * drive that stopped answering): after this long the call fails with
   * code "timeout" and the worker is told to stop it.
   */
  timeoutMs?: number;
}

/**
 * Runs `method` in the media worker. How every long job is cancelled: the
 * caller aborts `signal`, the worker stops the job (and the program it runs)
 * and the call rejects with a WorkerError whose code is "cancelled". A call
 * whose signal is aborted already never reaches the worker. A call with a
 * `timeoutMs` fails at once when it runs out, without waiting for the job
 * to notice: some (reading a file) can't be stopped halfway.
 */
export function callWorker<M extends WorkerMethod>(
  method: M,
  args: Parameters<WorkerMethods[M]>,
  options: CallOptions = {},
): Promise<ReturnType<WorkerMethods[M]>> {
  const { signal } = options;
  if (signal?.aborted) {
    // The worker would have closed these when the job ended.
    for (const port of options.transfer ?? []) port.close();
    return Promise.reject(new WorkerError('cancelled before it started', 'cancelled'));
  }
  const proc = worker();
  const id = nextId++;
  const cancel = () => proc.postMessage({ type: 'cancel', id });
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<ReturnType<WorkerMethods[M]>>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress: options.onProgress });
    proc.postMessage({ type: 'call', id, method, args }, options.transfer);
    signal?.addEventListener('abort', cancel, { once: true });
    if (options.timeoutMs !== undefined) {
      const ms = options.timeoutMs;
      timer = setTimeout(() => {
        // Its answer, if it ever comes, finds nobody waiting.
        pending.delete(id);
        cancel();
        reject(new WorkerError(`${method} took longer than ${ms / 1000} s`, 'timeout'));
      }, ms);
    }
  }).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  });
}

export function stopWorker(): void {
  child?.kill();
  child = undefined;
}
