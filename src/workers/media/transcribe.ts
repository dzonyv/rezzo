/**
 * Transcription: FFmpeg pulls 16 kHz mono audio out of the episode, then
 * whisper.cpp transcribes it with DTW word timings. Both steps keep their
 * results in the episode's cache folder, so a second project made from the
 * same video (or a retry after closing the app) doesn't redo them.
 */
import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { transcriptSchema, type Transcript } from '../../shared/project.ts';
import type { TranscribeProgress, TranscribeRequest } from '../../shared/worker-api.ts';
import { writeFileAtomic } from '../../node/files.ts';
import { exec, ExecError, ffmpegExe } from './exec.ts';
import type { JobContext } from './index.ts';
import { segmentsOf, type WhisperJson } from './whisper-json.ts';

/** Whisper's DTW preset for the model; only turbo is used so far. */
const DTW_PRESET: Record<string, string> = { 'large-v3-turbo-q5_0': 'large.v3.turbo' };

export class TranscribeError extends Error {
  readonly code = 'whisper-failed';
}

export async function transcribe(ctx: JobContext, req: TranscribeRequest): Promise<Transcript> {
  const done = path.join(req.cacheDir, `transcript-${req.language}-${req.modelId}.json`);
  const cached = await readTranscript(done);
  if (cached) return cached;

  await mkdir(req.cacheDir, { recursive: true });
  const wav = await extractAudio(ctx, req);
  const segments = await runWhisper(ctx, req, wav);
  const transcript: Transcript = {
    language: req.language,
    model: req.modelId,
    createdAt: new Date().toISOString(),
    segments,
  };
  await writeFileAtomic(done, JSON.stringify(transcript));
  return transcript;
}

async function readTranscript(file: string): Promise<Transcript | null> {
  try {
    return transcriptSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return null;
  }
}

async function extractAudio(ctx: JobContext, req: TranscribeRequest): Promise<string> {
  const wav = path.join(req.cacheDir, 'audio-16k.wav');
  if (await exists(wav)) return wav;
  const part = path.join(req.cacheDir, 'audio-16k.part.wav');
  const report = (fraction: number) => ctx.progress({ phase: 'audio', fraction } satisfies TranscribeProgress);
  report(0);
  await exec(
    ffmpegExe(),
    ['-y', '-v', 'error', '-nostats', '-progress', 'pipe:2', '-i', req.sourcePath,
     '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', part],
    {
      signal: ctx.signal,
      onStderrLine: (line) => {
        const m = /^out_time_us=(\d+)/.exec(line);
        if (m) report(Math.min(1, Number(m[1]) / 1e6 / req.duration));
      },
    },
  );
  await rename(part, wav);
  return wav;
}

async function runWhisper(ctx: JobContext, req: TranscribeRequest, wav: string) {
  const cli = await findFile(req.whisperDir, 'whisper-cli.exe');
  const base = path.join(req.cacheDir, `whisper-${req.language}`);
  const report = (fraction: number) => ctx.progress({ phase: 'transcribe', fraction } satisfies TranscribeProgress);
  report(0);
  try {
    await exec(
      cli,
      ['-m', req.modelFile, '-f', wav, '-l', req.language,
       '-t', String(Math.min(8, availableParallelism())),
       '-np', '-pp', '-ojf', '-of', base,
       // DTW word timings need flash attention off.
       '-dtw', DTW_PRESET[req.modelId] ?? 'large.v3.turbo', '-nfa'],
      {
        signal: ctx.signal,
        cwd: path.dirname(cli),
        onStderrLine: (line) => {
          const m = /progress\s*=\s*(\d+)%/.exec(line);
          if (m) report(Number(m[1]) / 100);
        },
      },
    );
  } catch (e) {
    if (ctx.signal.aborted || !(e instanceof ExecError)) throw e;
    throw new TranscribeError(e.message);
  }
  const json = await readWhisperJson(`${base}.json`);
  await rm(`${base}.json`, { force: true });
  return segmentsOf(json);
}

/**
 * whisper.cpp writes each token's raw bytes, and a token can hold half of a
 * UTF-8 character. Reading the file as Latin-1 keeps every byte as one
 * character, which segmentsOf() turns back into bytes before decoding.
 */
async function readWhisperJson(file: string): Promise<WhisperJson> {
  return JSON.parse(await readFile(file, 'latin1')) as WhisperJson;
}

async function findFile(dir: string, name: string): Promise<string> {
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.toLowerCase() === name) return path.join(entry.parentPath, entry.name);
  }
  throw new TranscribeError(`${name} not found in ${dir}`);
}

async function exists(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

