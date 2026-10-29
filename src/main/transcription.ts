/**
 * Runs a transcription for the renderer: installs whisper.cpp and the model
 * on first use, then hands the job to the media worker. One job at a time.
 */
import { app, type WebContents } from 'electron';
import path from 'node:path';
import { z } from 'zod';
import type { TranscribeResult, TranscriptionStatus } from '../shared/api.ts';
import { sourceSchema, TRANSCRIPT_LANGUAGES } from '../shared/project.ts';
import { WorkerError, type TranscribeProgress } from '../shared/worker-api.ts';
import { isInstalled } from '../node/tools/download.ts';
import { tool } from '../node/tools/manifest.ts';
import { cacheDir, downloadedToolDir } from './paths.ts';
import { callWorker } from './worker-host.ts';

const MODEL_ID = 'large-v3-turbo-q5_0';
const NVIDIA = 0x10de;

/** The CUDA build needs an NVIDIA card; everything else gets the CPU build. */
async function whisperBuild(): Promise<'whisper-cuda' | 'whisper-cpu'> {
  const info = (await app.getGPUInfo('basic')) as { gpuDevice?: { vendorId: number }[] };
  return info.gpuDevice?.some((d) => d.vendorId === NVIDIA) ? 'whisper-cuda' : 'whisper-cpu';
}

async function missingTools(ids: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const id of ids) if (!(await isInstalled(tool(id), downloadedToolDir(id)))) missing.push(id);
  return missing;
}

export async function transcriptionStatus(): Promise<TranscriptionStatus> {
  const build = await whisperBuild();
  const missing = await missingTools([build, MODEL_ID]);
  return {
    device: build === 'whisper-cuda' ? 'gpu' : 'cpu',
    downloadBytes: missing.reduce((sum, id) => sum + tool(id).size, 0),
  };
}

const requestSchema = z.object({
  projectId: z.uuid(),
  source: sourceSchema,
  language: z.enum(TRANSCRIPT_LANGUAGES),
});

let running: AbortController | undefined;

export function cancelTranscription(): void {
  running?.abort();
}

export async function startTranscription(sender: WebContents, request: unknown): Promise<TranscribeResult> {
  const { projectId, source, language } = requestSchema.parse(request);
  if (!source.audio) return { ok: false, error: 'no-audio' };

  running?.abort();
  const abort = new AbortController();
  running = abort;
  const send = (progress: TranscribeProgress) => {
    if (!sender.isDestroyed()) sender.send('transcribe:progress', { projectId, progress });
  };

  /** Whisper reported progress, i.e. it started fine and failed (if at all) for another reason. */
  let whisperStarted = false;
  const run = async (build: 'whisper-cuda' | 'whisper-cpu') => {
    await installTools([build, MODEL_ID], send, abort.signal);
    return callWorker(
      'transcribe',
      [{
        sourcePath: source.path,
        duration: source.duration,
        language,
        cacheDir: path.join(cacheDir(), source.fingerprint),
        whisperDir: downloadedToolDir(build),
        modelId: MODEL_ID,
        modelFile: path.join(downloadedToolDir(MODEL_ID), path.basename(new URL(tool(MODEL_ID).url).pathname)),
      }],
      {
        onProgress: (p) => {
          const progress = p as TranscribeProgress;
          if (progress.phase === 'transcribe' && progress.fraction > 0) whisperStarted = true;
          send(progress);
        },
        signal: abort.signal,
      },
    );
  };

  try {
    const build = await whisperBuild();
    try {
      return { ok: true, transcript: await run(build) };
    } catch (e) {
      // A CUDA build that won't start on this machine (old driver, odd
      // card): the CPU build is slow but works everywhere. A run that got
      // going and then failed would fail the same way on the CPU.
      const cudaWontStart = build === 'whisper-cuda' && e instanceof WorkerError && e.code === 'whisper-failed' && !whisperStarted;
      if (!cudaWontStart) throw e;
      return { ok: true, transcript: await run('whisper-cpu') };
    }
  } catch (e) {
    if (abort.signal.aborted) return { ok: false, error: 'cancelled' };
    const code = e instanceof WorkerError ? e.code : undefined;
    if (code === 'network' || code === 'http' || code === 'checksum' || code === 'extract') {
      return { ok: false, error: 'download-failed', detail: e instanceof Error ? e.message : String(e) };
    }
    return { ok: false, error: 'whisper-failed', detail: e instanceof Error ? e.message : String(e) };
  } finally {
    if (running === abort) running = undefined;
  }
}

/** Downloads whatever is missing, reporting progress over all of it. */
async function installTools(ids: string[], send: (p: TranscribeProgress) => void, signal: AbortSignal): Promise<void> {
  const missing = await missingTools(ids);
  const total = missing.reduce((sum, id) => sum + tool(id).size, 0);
  let done = 0;
  for (const id of missing) {
    await callWorker('installTool', [id, downloadedToolDir(id)], {
      signal,
      onProgress: (p) => send({ phase: 'download', received: done + (p as { received: number }).received, total }),
    });
    done += tool(id).size;
  }
}
