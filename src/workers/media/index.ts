/**
 * The media worker: an Electron utility process that runs FFmpeg, ffprobe
 * and whisper.cpp and does anything CPU-heavy in JavaScript. The main
 * process talks to it with WorkerRequest/WorkerReply messages.
 */
import type { MessagePortMain } from 'electron';
import type { WorkerMethod, WorkerMethods, WorkerReply, WorkerRequest } from '../../shared/worker-api.ts';
import { encodeExport, pickEncoder } from './export.ts';
import { fingerprint } from './fingerprint.ts';
import { measureLevels, measureLoudness } from './loudness.ts';
import { readLottieInfo } from './lottie-file.ts';
import { makePreview } from './preview.ts';
import { probe, probeAudio, probeVideo } from './probe.ts';
import { makeThumbnail } from './thumbnail.ts';
import { transcribe } from './transcribe.ts';
import { diarize } from './voices.ts';
import { makeOverlayFile, makeWorkingFile } from './working.ts';
import { install } from '../../node/tools/download.ts';
import { tool } from '../../node/tools/manifest.ts';

export interface JobContext {
  signal: AbortSignal;
  progress(value: unknown): void;
  /** Ports sent along with the call (an export's frame channel). */
  ports: MessagePortMain[];
}

type Handlers = {
  [M in WorkerMethod]: (ctx: JobContext, ...args: Parameters<WorkerMethods[M]>) => Promise<ReturnType<WorkerMethods[M]>>;
};

const handlers: Handlers = {
  probe: (ctx, file) => probe(file, ctx.signal),
  probeVideo: (ctx, file) => probeVideo(file, ctx.signal),
  probeAudio: (ctx, file) => probeAudio(file, ctx.signal),
  readLottie: (_ctx, file) => readLottieInfo(file),
  fingerprint: (_ctx, file) => fingerprint(file),
  installTool: (ctx, id, dir) => install(tool(id), dir, { onProgress: ctx.progress, signal: ctx.signal }),
  transcribe: (ctx, request) => transcribe(ctx, request),
  diarize: (ctx, request) => diarize(ctx, request),
  makePreview: (ctx, request) => makePreview(ctx, request),
  makeThumbnail: (ctx, request) => makeThumbnail(ctx, request),
  makeWorkingFile: (ctx, request) => makeWorkingFile(ctx, request),
  makeOverlayFile: (ctx, request) => makeOverlayFile(ctx, request),
  measureLoudness: (ctx, request) => measureLoudness(request, ctx.signal),
  measureLevels: (ctx, request) => measureLevels(request, ctx.signal),
  pickEncoder: () => pickEncoder(),
  encodeExport: (ctx, request) => encodeExport(ctx, request),
};

const running = new Map<number, AbortController>();
const reply = (message: WorkerReply) => process.parentPort.postMessage(message);

process.parentPort.on('message', ({ data, ports }) => {
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
    ports,
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
