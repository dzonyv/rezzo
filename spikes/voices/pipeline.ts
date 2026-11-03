/**
 * The transcript-driven diarization from words.ts, sized for a whole
 * episode: pieces cut at pauses, one embedding per piece, and average-linkage
 * clustering in O(n²) (nearest-neighbour chain) instead of the naive O(n³).
 */
import { createRequire } from 'node:module';

export interface Piece {
  start: number;
  end: number;
}

interface Stream {
  acceptWaveform(w: { sampleRate: number; samples: Float32Array }): void;
  inputFinished(): void;
}
const sherpa = createRequire(import.meta.url)('sherpa-onnx-node') as {
  SpeakerEmbeddingExtractor: new (config: object) => { createStream(): Stream; compute(s: Stream, external?: boolean): Float32Array };
};

/** Words joined into pieces, split at pauses of `gap` seconds and at `max` seconds. */
export function piecesOf(words: Piece[], gap = 0.3, max = 3): Piece[] {
  const pieces: Piece[] = [];
  for (const w of [...words].sort((a, b) => a.start - b.start)) {
    if (w.end <= w.start) continue;
    const last = pieces.at(-1);
    if (last && w.start - last.end < gap && w.end - last.start <= max) last.end = Math.max(last.end, w.end);
    else pieces.push({ ...w });
  }
  return pieces;
}

export function embed(samples: Float32Array, pieces: Piece[], model: string, threads = 4, onProgress?: (done: number) => void): Float32Array[] {
  const ex = new sherpa.SpeakerEmbeddingExtractor({ model, numThreads: threads });
  return pieces.map((p, i) => {
    const s = ex.createStream();
    s.acceptWaveform({ sampleRate: 16000, samples: samples.subarray(Math.floor(p.start * 16000), Math.ceil(p.end * 16000)) });
    s.inputFinished();
    if (onProgress && i % 100 === 0) onProgress(i);
    return normalised(ex.compute(s));
  });
}

function normalised(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  return Float32Array.from(v, (x) => x / n);
}

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

export interface Merge {
  a: number;
  b: number;
  distance: number;
}

/**
 * Every merge of average-linkage clustering on cosine distance, sorted by
 * distance. Nearest-neighbour chain: O(n²) time, one n×n matrix.
 * `a` and `b` are original indices, one from each side of the merge, so the
 * merges can be replayed with union-find in any prefix.
 */
export function dendrogram(vectors: Float32Array[]): Merge[] {
  const n = vectors.length;
  const d = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) d[i * n + j] = d[j * n + i] = 1 - dot(vectors[i], vectors[j]);
  const size = new Array<number>(n).fill(1);
  const active = new Set<number>(Array.from({ length: n }, (_, i) => i));
  const merges: Merge[] = [];
  const chain: number[] = [];
  while (active.size > 1) {
    if (chain.length === 0) chain.push(active.values().next().value!);
    const a = chain.at(-1)!;
    const prev = chain.at(-2);
    let b = prev ?? -1;
    let best = prev === undefined ? Infinity : d[a * n + prev];
    for (const k of active) {
      if (k !== a && d[a * n + k] < best) {
        best = d[a * n + k];
        b = k;
      }
    }
    if (b === prev) {
      chain.pop();
      chain.pop();
      merges.push({ a, b, distance: best });
      // Lance–Williams for average linkage; the merged cluster keeps slot a.
      for (const k of active) {
        if (k === a || k === b) continue;
        const v = (size[a] * d[a * n + k] + size[b] * d[b * n + k]) / (size[a] + size[b]);
        d[a * n + k] = d[k * n + a] = v;
      }
      size[a] += size[b];
      active.delete(b);
    } else {
      chain.push(b);
    }
  }
  return merges.sort((x, y) => x.distance - y.distance);
}

/** Cluster label per vector after the merges up to `threshold`, or down to `k` clusters. */
export function cut(n: number, merges: Merge[], stop: { threshold: number } | { k: number }): number[] {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const count = 'k' in stop ? n - stop.k : merges.filter((m) => m.distance <= stop.threshold).length;
  for (const m of merges.slice(0, count)) parent[find(m.a)] = find(m.b);
  const ids = new Map<number, number>();
  return Array.from({ length: n }, (_, i) => {
    const r = find(i);
    if (!ids.has(r)) ids.set(r, ids.size);
    return ids.get(r)!;
  });
}

/**
 * Clusters the pieces of at least `minCluster` seconds, then gives every
 * piece the voice whose centroid is nearest.
 */
export function voicesOf(pieces: Piece[], vectors: Float32Array[], stop: { threshold: number } | { k: number }, minCluster = 1.0): number[] {
  const long = pieces.map((_, i) => i).filter((i) => pieces[i].end - pieces[i].start >= minCluster);
  const labels = cut(long.length, dendrogram(long.map((i) => vectors[i])), stop);
  const k = Math.max(...labels) + 1;
  const centroids = Array.from({ length: k }, () => new Float32Array(vectors[0].length));
  long.forEach((i, x) => vectors[i].forEach((v, j) => (centroids[labels[x]][j] += v)));
  const unit = centroids.map(normalised);
  return vectors.map((v) => {
    let best = 0;
    for (let c = 1; c < k; c++) if (dot(v, unit[c]) > dot(v, unit[best])) best = c;
    return best;
  });
}
