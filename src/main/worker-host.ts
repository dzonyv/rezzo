/**
 * Starts the media worker on first use and forwards calls to it. If the
 * worker dies, pending calls fail and the next call starts a fresh one.
 */
import { utilityProcess, type MessagePortMain, type UtilityProcess } from 'electron';
import path from 'node:path';
import workerPath from '../workers/media/index.ts?modulePath';
import { WorkerError, type WorkerMethod, type WorkerMethods, type WorkerReply } from '../shared/worker-api.ts';
import { ffmpegBinDir } from './paths.ts';

interface Pending {
  /** Every string in the call's arguments: the files and folders the job works with (inUse). */
  paths: string[];
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
  const paths = stringsIn(args);
  const wait = waitFor(paths);
  if (wait) return wait.then(() => callWorker(method, args, options));
  const proc = worker();
  const id = nextId++;
  const cancel = () => proc.postMessage({ type: 'cancel', id });
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<ReturnType<WorkerMethods[M]>>((resolve, reject) => {
    pending.set(id, { paths, resolve: resolve as (v: unknown) => void, reject, onProgress: options.onProgress });
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

/** Every string inside `value`, however deep. */
function stringsIn(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsIn(v, into);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) stringsIn(v, into);
  return into;
}

/** Whether `file` is `dir` or inside it (Windows paths: case doesn't matter). Strings that aren't absolute paths aren't. */
function isInside(file: string, dir: string): boolean {
  if (!path.isAbsolute(file)) return false;
  const rel = path.relative(path.resolve(dir).toLowerCase(), path.resolve(file).toLowerCase());
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Whether a running job of the media worker was handed a file or folder inside `dir`. */
export function inUse(dir: string): boolean {
  return [...pending.values()].some((p) => p.paths.some((f) => isInside(f, dir)));
}

/** Folders being deleted (main/storage.ts), with when they're done. */
const held = new Map<string, Promise<unknown>>();

/**
 * Runs `work` (deleting `dir`) with no job starting in `dir` meanwhile: a
 * call handed a path inside it waits until `work` is over. Check inUse
 * first; together they leave no moment for a job to lose its files.
 */
export function holding<T>(dir: string, work: () => Promise<T>): Promise<T> {
  const done = work();
  const settled = done.then(
    () => {},
    () => {},
  );
  held.set(dir, settled);
  void settled.then(() => {
    if (held.get(dir) === settled) held.delete(dir);
  });
  return done;
}

/** What a call handed `paths` waits for before it starts: the deleting of a folder they're in. */
function waitFor(paths: readonly string[]): Promise<unknown> | null {
  for (const [dir, done] of held) if (paths.some((f) => isInside(f, dir))) return done;
  return null;
}

export function stopWorker(): void {
  child?.kill();
  child = undefined;
}
