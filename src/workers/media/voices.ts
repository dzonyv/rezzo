/**
 * Telling the episode's voices apart: a speaker embedding for every piece of
 * the transcript (sherpa-onnx with the 3D-Speaker CAM++ model, on the CPU),
 * then clustering (shared/voices.ts). The embeddings are cached, so changing
 * the number of people only redoes the clustering.
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

export async function diarize(ctx: JobContext, req: VoicesRequest): Promise<EpisodeVoices> {
  const done = path.join(req.cacheDir, `voices.v${VOICES_VERSION}.json`);
  const cached = await readJson(done, (v) => episodeVoicesSchema.parse(v));
  if (cached && cached.transcriptAt === req.transcriptAt && cached.count === req.count) return cached;

  await mkdir(req.cacheDir, { recursive: true });
  const embeddings = await embeddingsOf(ctx, req);
  const voices = voicesOf(req.pieces, embeddings, req.count);
  const result: EpisodeVoices = {
    version: VOICES_VERSION,
    transcriptAt: req.transcriptAt,
    count: req.count,
    voices: new Set(voices).size,
    turns: turnsOf(req.pieces, voices),
  };
  await writeFileAtomic(done, JSON.stringify(result));
  return result;
}

/** One embedding per piece, from the cache when the pieces are the same. */
async function embeddingsOf(ctx: JobContext, req: VoicesRequest): Promise<Float32Array[]> {
  const key = createHash('sha256').update(JSON.stringify(req.pieces)).update(path.basename(req.modelFile)).digest('hex');
  const file = path.join(req.cacheDir, `voice-embeddings.v${VOICES_VERSION}.json`);
  const cached = await readJson(file, (v) => v as { key: string; dim: number; data: string });
  if (cached?.key === key) {
    const all = new Float32Array(new Uint8Array(Buffer.from(cached.data, 'base64')).buffer);
    return req.pieces.map((_, i) => all.subarray(i * cached.dim, (i + 1) * cached.dim));
  }

  const wav = await extractAudio(ctx, req);
  const samples = pcmOf(await readFile(wav));
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
  const out: Float32Array[] = [];
  for (const [i, piece] of req.pieces.entries()) {
    if (ctx.signal.aborted) throw new Error('cancelled');
    out.push(embed(sherpa, extractor, samples, piece));
    if (i % 25 === 0) report(i / req.pieces.length);
    // A piece takes ~20 ms; let other jobs and the cancel message through now and then.
    if (i % 5 === 4) await new Promise((r) => setImmediate(r));
  }
  report(1);

  const dim = out[0]?.length ?? 0;
  const all = new Float32Array(out.length * dim);
  out.forEach((v, i) => all.set(v, i * dim));
  await writeFileAtomic(file, JSON.stringify({ key, dim, data: Buffer.from(all.buffer).toString('base64') }));
  return out;
}

function embed(sherpa: SherpaAddon, extractor: unknown, samples: Float32Array, piece: Span): Float32Array {
  const stream = sherpa.speakerEmbeddingExtractorCreateStream(extractor);
  sherpa.acceptWaveformOnline(stream, {
    sampleRate: SAMPLE_RATE,
    samples: samples.subarray(Math.floor(piece.start * SAMPLE_RATE), Math.ceil(piece.end * SAMPLE_RATE)),
  });
  sherpa.inputFinished(stream);
  // Copy: without the external buffer the result is ours to keep.
  return Float32Array.from(sherpa.speakerEmbeddingExtractorComputeEmbedding(extractor, stream, false));
}

/**
 * The samples of a 16-bit mono PCM WAV file as floats. The header isn't
 * always 44 bytes (FFmpeg adds a LIST chunk), so walk the chunks to "data".
 */
export function pcmOf(wav: Uint8Array): Float32Array {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = String.fromCharCode(...wav.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === 'data') {
      const start = offset + 8;
      const count = Math.floor(Math.min(size, wav.length - start) / 2);
      const out = new Float32Array(count);
      for (let i = 0; i < count; i++) out[i] = view.getInt16(start + 2 * i, true) / 32768;
      return out;
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
