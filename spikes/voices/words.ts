/**
 * Diarization driven by the transcript: whisper already knows where the
 * words are, so cut the speech into pieces at pauses, take a speaker
 * embedding of each piece with sherpa-onnx, and cluster them ourselves.
 *
 *   node voices/words.ts [--models a,b] [--gap 0.2] [--max 3]
 *
 * Embeddings are cached per audio file and model in <media>/voices/embeddings/;
 * clustering is cheap and runs for every setting. Writes runs named
 * `w-n<k>` (known number of speakers) and `w-t<x>` (cosine distance
 * threshold) next to diarize.ts's, so score.ts scores both.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DRAFT_MODEL, listClips, runsDir as whisperRunsDir } from '../whisper/clips.ts';
import { wordsOf, type WhisperJson } from '../whisper/words.ts';
import { audioFile, EMBEDDINGS, JOINED, joinedParts, readSamples, runPath, runsDir, SPEAKERS, voiceModelsDir, voicesDir, type Run, type Segment } from './common.ts';

interface Stream {
  acceptWaveform(w: { sampleRate: number; samples: Float32Array }): void;
  inputFinished(): void;
}
const sherpa = createRequire(import.meta.url)('sherpa-onnx-node') as {
  SpeakerEmbeddingExtractor: new (config: object) => { dim: number; createStream(): Stream; compute(s: Stream, external?: boolean): Float32Array };
};

const { values } = parseArgs({
  options: {
    models: { type: 'string', default: Object.keys(EMBEDDINGS).join(',') },
    gap: { type: 'string', default: '0.2' },
    max: { type: 'string', default: '3' },
    settings: { type: 'string', default: 'n,t0.3,t0.4,t0.5,t0.6,t0.7' },
  },
});
const GAP = Number(values.gap);
const MAX = Number(values.max);
/** Pieces at least this long decide the clusters; shorter ones just join the nearest. */
const MIN_CLUSTER = 1.0;

interface Piece {
  start: number;
  end: number;
}

async function wordsOfClip(id: string): Promise<Piece[]> {
  const clip = listClips().find((c) => c.id === id)!;
  const draft = JSON.parse(await readFile(path.join(whisperRunsDir(clip), `${DRAFT_MODEL}__${clip.lang}.json`), 'utf8')) as WhisperJson;
  return wordsOf(draft).map((w) => ({ start: w.start, end: w.end }));
}

async function wordsOfAudio(audio: string): Promise<Piece[]> {
  if (audio !== JOINED) return wordsOfClip(audio);
  const out: Piece[] = [];
  let offset = 0;
  for (const id of await joinedParts()) {
    for (const w of await wordsOfClip(id)) out.push({ start: w.start + offset, end: w.end + offset });
    offset += (await readSamples(audioFile(id))).length / 16000;
  }
  return out;
}

/** Words joined into pieces, split at pauses of `GAP` and at `MAX` seconds. */
function piecesOf(words: Piece[]): Piece[] {
  const pieces: Piece[] = [];
  for (const w of [...words].sort((a, b) => a.start - b.start)) {
    if (w.end <= w.start) continue;
    const last = pieces.at(-1);
    if (last && w.start - last.end < GAP && w.end - last.start <= MAX) last.end = Math.max(last.end, w.end);
    else pieces.push({ ...w });
  }
  return pieces;
}

const cosine = (a: Float32Array, b: Float32Array) => {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return 1 - ab / Math.sqrt(aa * bb);
};

/**
 * Average-linkage agglomerative clustering on cosine distance, until `k`
 * clusters remain or the closest two are further apart than `threshold`.
 */
function cluster(vectors: Float32Array[], stop: { k: number } | { threshold: number }): number[] {
  const n = vectors.length;
  const d = vectors.map((a) => vectors.map((b) => cosine(a, b)));
  let clusters = vectors.map((_, i) => [i]);
  const dist = (a: number[], b: number[]) => {
    let s = 0;
    for (const i of a) for (const j of b) s += d[i][j];
    return s / (a.length * b.length);
  };
  while (clusters.length > 1) {
    if ('k' in stop && clusters.length <= stop.k) break;
    let best = { i: 0, j: 1, d: Infinity };
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const x = dist(clusters[i], clusters[j]);
        if (x < best.d) best = { i, j, d: x };
      }
    }
    if ('threshold' in stop && best.d > stop.threshold) break;
    clusters[best.i] = clusters[best.i].concat(clusters[best.j]);
    clusters = clusters.filter((_, x) => x !== best.j);
  }
  const label = new Array<number>(n);
  clusters.forEach((c, k) => c.forEach((i) => (label[i] = k)));
  return label;
}

function centroid(vectors: Float32Array[]): Float32Array {
  const c = new Float32Array(vectors[0].length);
  for (const v of vectors) {
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm);
    for (let i = 0; i < v.length; i++) c[i] += v[i] / norm;
  }
  return c;
}

const embeddingsDir = path.join(voicesDir, 'embeddings');
await mkdir(embeddingsDir, { recursive: true });
await mkdir(runsDir, { recursive: true });

for (const audio of Object.keys(SPEAKERS)) {
  const samples = await readSamples(audioFile(audio));
  const pieces = piecesOf(await wordsOfAudio(audio));
  for (const model of values.models.split(',')) {
    const cache = path.join(embeddingsDir, `${audio}__${model}__g${GAP}m${MAX}.json`);
    let vectors: Float32Array[];
    let embedSeconds: number;
    if (existsSync(cache)) {
      const c = JSON.parse(await readFile(cache, 'utf8')) as { seconds: number; vectors: number[][] };
      vectors = c.vectors.map((v) => Float32Array.from(v));
      embedSeconds = c.seconds;
    } else {
      const ex = new sherpa.SpeakerEmbeddingExtractor({ model: path.join(voiceModelsDir, EMBEDDINGS[model]), numThreads: 4 });
      const t0 = performance.now();
      vectors = pieces.map((p) => {
        const s = ex.createStream();
        s.acceptWaveform({ sampleRate: 16000, samples: samples.subarray(Math.floor(p.start * 16000), Math.ceil(p.end * 16000)) });
        s.inputFinished();
        return Float32Array.from(ex.compute(s));
      });
      embedSeconds = (performance.now() - t0) / 1000;
      await writeFile(cache, JSON.stringify({ seconds: embedSeconds, vectors: vectors.map((v) => [...v]) }));
    }
    const long = pieces.map((p, i) => i).filter((i) => pieces[i].end - pieces[i].start >= MIN_CLUSTER);
    for (const setting of values.settings.split(',')) {
      // Pieces other than the default (0.2 s pauses, 3 s at most) show in the name.
      const prefix = GAP === 0.2 && MAX === 3 ? 'w' : `w${GAP}/${MAX}`.replace('/', 'm');
      const name = setting === 'n' ? `${prefix}-n${SPEAKERS[audio]}` : `${prefix}-${setting}`;
      const t0 = performance.now();
      const stop = setting === 'n' ? { k: SPEAKERS[audio] } : { threshold: Number(setting.slice(1)) };
      const labels = cluster(long.map((i) => vectors[i]), stop);
      const k = Math.max(...labels) + 1;
      const centroids = Array.from({ length: k }, (_, c) => centroid(long.filter((_, x) => labels[x] === c).map((i) => vectors[i])));
      const segments: Segment[] = pieces.map((p, i) => {
        let best = 0;
        for (let c = 1; c < k; c++) if (cosine(vectors[i], centroids[c]) < cosine(vectors[i], centroids[best])) best = c;
        return { start: p.start, end: p.end, speaker: best };
      });
      const run: Run = {
        audio,
        model,
        setting: name,
        threads: 4,
        audioSeconds: samples.length / 16000,
        wallSeconds: embedSeconds + (performance.now() - t0) / 1000,
        segments,
      };
      await writeFile(runPath(audio, model, name), JSON.stringify(run));
    }
    console.log(`${audio.padEnd(11)} ${model.padEnd(15)} ${pieces.length} pieces (${long.length} ≥ ${MIN_CLUSTER} s), embeddings ${embedSeconds.toFixed(1)} s`);
  }
}
