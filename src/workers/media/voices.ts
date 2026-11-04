/**
 * Telling the episode's voices apart: a speaker embedding for every piece of
 * the transcript (sherpa-onnx with the 3D-Speaker CAM++ model, on the CPU),
 * then clustering (shared/voices.ts). Embeddings are cached piece by piece,
 * so changing the number of people only redoes the clustering, and editing
 * a few words only redoes the pieces they changed.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { episodeVoicesSchema, turnsOf, voicesOf, VOICES_VERSION, type EpisodeVoices, type Span } from '../../shared/voices.ts';
import type { VoicesProgress, VoicesRequest } from '../../shared/worker-api.ts';
import { writeFileAtomic } from '../../node/files.ts';
import type { JobContext } from './index.ts';
import { extractAudio } from './transcribe.ts';

const SAMPLE_RATE = 16000;
const THREADS = 4;

/** The parts of sherpa-onnx's native addon we use (see its speaker-identification.js). */
interface SherpaAddon {
  createSpeakerEmbeddingExtractor(config: { model: string; numThreads: number; debug: number; provider: string }): unknown;
  speakerEmbeddingExtractorCreateStream(extractor: unknown): unknown;
  acceptWaveformOnline(stream: unknown, wave: { sampleRate: number; samples: Float32Array }): void;
  inputFinished(stream: unknown): void;
  speakerEmbeddingExtractorComputeEmbedding(extractor: unknown, stream: unknown, enableExternalBuffer: boolean): Float32Array;
}

let addon: { file: string; exports: SherpaAddon } | undefined;

/** Loads the addon once. Its DLLs sit next to it, where Windows looks for them. */
function loadAddon(file: string): SherpaAddon {
  if (addon?.file !== file) {
    const module = { exports: {} as SherpaAddon };
    process.dlopen(module, file);
    addon = { file, exports: module.exports };
  }
  return addon.exports;
}

export class VoicesError extends Error {
  readonly code = 'voices-failed';
}

const pieceKey = (p: Span) => `${p.start}|${p.end}`;

export async function diarize(ctx: JobContext, req: VoicesRequest): Promise<EpisodeVoices> {
  // The result depends on the pieces (edited words change them), the model and the count.
  const key = createHash('sha256').update(JSON.stringify(req.pieces)).update(path.basename(req.modelFile)).update(String(req.count)).digest('hex');
  const done = path.join(req.cacheDir, `voices.v${VOICES_VERSION}.json`);
  const cached = await readJson(done, (v) => episodeVoicesSchema.parse(v));
  if (cached?.key === key) return cached;

  await mkdir(req.cacheDir, { recursive: true });
  const embeddings = await embeddingsOf(ctx, req);
  // A job that was replaced has nothing to add, and would write over the new one's result.
  if (ctx.signal.aborted) throw new Error('cancelled');
  const voices = voicesOf(req.pieces, embeddings, req.count);
  const result: EpisodeVoices = {
    version: VOICES_VERSION,
    key,
    count: req.count,
    voices: new Set(voices).size,
    turns: turnsOf(req.pieces, voices),
  };
  await writeFileAtomic(done, JSON.stringify(result));
  return result;
}

interface EmbeddingCache {
  model: string;
  dim: number;
  /** "start|end" of each piece, in the order of `data`. */
  pieces: string[];
  /** Float32 vectors, back to back, base64. */
  data: string;
}

/** One embedding per piece: from the cache for pieces seen before, computed for the rest. */
async function embeddingsOf(ctx: JobContext, req: VoicesRequest): Promise<Float32Array[]> {
  const model = path.basename(req.modelFile);
  const file = path.join(req.cacheDir, `voice-embeddings.v${VOICES_VERSION}.json`);
  const known = new Map<string, Float32Array>();
  const cached = await readJson(file, (v) => v as EmbeddingCache);
  if (cached?.model === model && Array.isArray(cached.pieces)) {
    const all = new Float32Array(new Uint8Array(Buffer.from(cached.data, 'base64')).buffer);
    cached.pieces.forEach((k, i) => known.set(k, all.subarray(i * cached.dim, (i + 1) * cached.dim)));
  }
  const missing = req.pieces.filter((p) => !known.has(pieceKey(p)));

  if (missing.length > 0) {
    const pcm = pcmOf(await readFile(await extractAudio(ctx, req)));
    const report = (fraction: number) => ctx.progress({ phase: 'voices', fraction } satisfies VoicesProgress);
    report(0);
    let sherpa: SherpaAddon;
    let extractor: unknown;
    try {
      sherpa = loadAddon(req.addonFile);
      extractor = sherpa.createSpeakerEmbeddingExtractor({ model: req.modelFile, numThreads: THREADS, debug: 0, provider: 'cpu' });
    } catch (e) {
      throw new VoicesError(`sherpa-onnx: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const [i, piece] of missing.entries()) {
      if (ctx.signal.aborted) throw new Error('cancelled');
      known.set(pieceKey(piece), embed(sherpa, extractor, pcm.samples(piece.start, piece.end)));
      if (i % 25 === 0) report(i / missing.length);
      // A piece takes ~20 ms; let other jobs and the cancel message through now and then.
      if (i % 5 === 4) await new Promise((r) => setImmediate(r));
    }
    report(1);
  }

  const out = req.pieces.map((p) => known.get(pieceKey(p))!);
  if (missing.length > 0) {
    // Keep only this transcript's pieces, so the cache doesn't grow with every edit.
    const dim = out[0]?.length ?? 0;
    const all = new Float32Array(out.length * dim);
    out.forEach((v, i) => all.set(v, i * dim));
    const next: EmbeddingCache = { model, dim, pieces: req.pieces.map(pieceKey), data: Buffer.from(all.buffer).toString('base64') };
    await writeFileAtomic(file, JSON.stringify(next));
  }
  return out;
}

function embed(sherpa: SherpaAddon, extractor: unknown, samples: Float32Array): Float32Array {
  const stream = sherpa.speakerEmbeddingExtractorCreateStream(extractor);
  sherpa.acceptWaveformOnline(stream, { sampleRate: SAMPLE_RATE, samples });
  sherpa.inputFinished(stream);
  // Copy: without the external buffer the result is ours to keep.
  return Float32Array.from(sherpa.speakerEmbeddingExtractorComputeEmbedding(extractor, stream, false));
}

/**
 * A 16-bit mono PCM WAV file, read as floats a stretch at a time (the whole
 * episode as floats would be twice the size of the file). The header isn't
 * always 44 bytes (FFmpeg adds a LIST chunk), so walk the chunks to "data".
 */
export function pcmOf(wav: Uint8Array): { length: number; samples(start: number, end: number): Float32Array } {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = String.fromCharCode(...wav.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === 'data') {
      const first = offset + 8;
      const length = Math.floor(Math.min(size, wav.length - first) / 2);
      return {
        length,
        samples(start, end) {
          const a = Math.min(length, Math.max(0, Math.floor(start * SAMPLE_RATE)));
          const b = Math.min(length, Math.max(a, Math.ceil(end * SAMPLE_RATE)));
          const out = new Float32Array(b - a);
          for (let i = 0; i < out.length; i++) out[i] = view.getInt16(first + 2 * (a + i), true) / 32768;
          return out;
        },
      };
    }
    offset += 8 + size + (size & 1);
  }
  throw new VoicesError('WAV file has no data chunk');
}

async function readJson<T>(file: string, parse: (v: unknown) => T): Promise<T | null> {
  try {
    return parse(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return null;
  }
}
