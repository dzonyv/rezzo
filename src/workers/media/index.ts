/**
 * The media worker: an Electron utility process that runs FFmpeg, ffprobe
 * and whisper.cpp and does anything CPU-heavy in JavaScript. The main
 * process talks to it with WorkerRequest/WorkerReply messages.
 */
import type { WorkerMethod, WorkerMethods, WorkerReply, WorkerRequest } from '../../shared/worker-api.ts';
import { fingerprint } from './fingerprint.ts';
import { makePreview } from './preview.ts';
import { probe } from './probe.ts';
import { transcribe } from './transcribe.ts';
import { makeWorkingFile } from './working.ts';
import { install } from '../../node/tools/download.ts';
import { tool } from '../../node/tools/manifest.ts';

export interface JobContext {
  signal: AbortSignal;
  progress(value: unknown): void;
}

type Handlers = {
  [M in WorkerMethod]: (ctx: JobContext, ...args: Parameters<WorkerMethods[M]>) => Promise<ReturnType<WorkerMethods[M]>>;
};

const handlers: Handlers = {
  probe: (_ctx, file) => probe(file),
  fingerprint: (_ctx, file) => fingerprint(file),
  installTool: (ctx, id, dir) => install(tool(id), dir, { onProgress: ctx.progress, signal: ctx.signal }),
  transcribe: (ctx, request) => transcribe(ctx, request),
  makePreview: (ctx, request) => makePreview(ctx, request),
  makeWorkingFile: (ctx, request) => makeWorkingFile(ctx, request),
};

const running = new Map<number, AbortController>();
const reply = (message: WorkerReply) => process.parentPort.postMessage(message);

process.parentPort.on('message', ({ data }) => {
  const req = data as WorkerRequest;
  if (req.type === 'cancel') {
    running.get(req.id)?.abort();
    return;
  }
  const abort = new AbortController();
  running.set(req.id, abort);
  const ctx: JobContext = {
    signal: abort.signal,
    progress: (progress) => reply({ type: 'progress', id: req.id, progress }),
  };
  const handler = handlers[req.method] as (ctx: JobContext, ...args: unknown[]) => Promise<unknown>;
  handler(ctx, ...req.args)
    .then(
      (value) => reply({ type: 'result', id: req.id, value }),
      (e: unknown) => {
        const err = e as { message?: string; code?: unknown; name?: string };
        const code = abort.signal.aborted ? 'cancelled' : typeof err.code === 'string' ? err.code : undefined;
        reply({ type: 'error', id: req.id, message: String(err.message ?? e), code });
      },
    )
    .finally(() => running.delete(req.id));
});
