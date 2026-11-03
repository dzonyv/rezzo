/**
 * Tells the episode's voices apart for the renderer, from the transcript's
 * words; the media worker does the work and keeps the result in the cache.
 * One job at a time: a new request cancels the one running.
 */
import type { WebContents } from 'electron';
import path from 'node:path';
import { z } from 'zod';
import type { VoicesResult } from '../shared/api.ts';
import { sourceSchema, transcriptSchema } from '../shared/project.ts';
import { piecesOf, speakerCountSchema } from '../shared/voices.ts';
import type { VoicesProgress } from '../shared/worker-api.ts';
import { tool } from '../node/tools/manifest.ts';
import { bundledToolDir, cacheDir } from './paths.ts';
import { callWorker } from './worker-host.ts';

const requestSchema = z.object({
  projectId: z.uuid(),
  source: sourceSchema,
  transcript: transcriptSchema,
  count: speakerCountSchema,
});

/** The addon and its DLLs, as the npm package unpacks (tools.json "sherpa-onnx"). */
export const sherpaAddonFile = (): string => path.join(bundledToolDir('sherpa-onnx'), 'package', 'sherpa-onnx.node');

export function voiceModelFile(): string {
  const id = 'voice-embeddings';
  return path.join(bundledToolDir(id), path.basename(new URL(tool(id).url).pathname));
}

let running: AbortController | undefined;

export function cancelVoices(): void {
  running?.abort();
}

export async function startVoices(sender: WebContents, request: unknown): Promise<VoicesResult> {
  const { projectId, source, transcript, count } = requestSchema.parse(request);
  if (!source.audio) return { ok: false, error: 'no-audio' };

  running?.abort();
  const abort = new AbortController();
  running = abort;
  const words = transcript.segments.flatMap((s) => s.words);
  try {
    const voices = await callWorker(
      'diarize',
      [{
        sourcePath: source.path,
        duration: source.duration,
        cacheDir: path.join(cacheDir(), source.fingerprint),
        pieces: piecesOf(words),
        count,
        addonFile: sherpaAddonFile(),
        modelFile: voiceModelFile(),
      }],
      {
        signal: abort.signal,
        onProgress: (progress) => {
          if (!sender.isDestroyed()) sender.send('voices:progress', { projectId, progress: progress as VoicesProgress });
        },
      },
    );
    return { ok: true, voices };
  } catch (e) {
    if (abort.signal.aborted) return { ok: false, error: 'cancelled' };
    return { ok: false, error: 'failed', detail: e instanceof Error ? e.message : String(e) };
  } finally {
    if (running === abort) running = undefined;
  }
}
