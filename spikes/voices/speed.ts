/**
 * How long transcript-driven diarization takes on an hour of audio, and how
 * much memory it needs. Until we have a full episode, the joined clips are
 * repeated to an hour: fine for timing, meaningless for accuracy.
 *
 *   node voices/speed.ts [--model campplus-zh-en] [--minutes 60] [--threads 1,2,4,8]
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { audioFile, EMBEDDINGS, JOINED, readSamples, voiceModelsDir } from './common.ts';

interface Stream {
  acceptWaveform(w: { sampleRate: number; samples: Float32Array }): void;
  inputFinished(): void;
}
const sherpa = createRequire(import.meta.url)('sherpa-onnx-node') as {
  SpeakerEmbeddingExtractor: new (config: object) => { createStream(): Stream; compute(s: Stream, external?: boolean): Float32Array };
};

const { values } = parseArgs({
  options: {
    model: { type: 'string', default: 'campplus-zh-en' },
    minutes: { type: 'string', default: '60' },
    threads: { type: 'string', default: '1,2,4,8' },
    piece: { type: 'string', default: '1.6' },
  },
});

const one = await readSamples(audioFile(JOINED));
const total = Math.round(Number(values.minutes) * 60 * 16000);
const samples = new Float32Array(total);
for (let at = 0; at < total; at += one.length) samples.set(one.subarray(0, Math.min(one.length, total - at)), at);
// Pieces the size the transcript gives on our clips (median ~1.6 s), back to back.
const step = Number(values.piece);
const pieces: [number, number][] = [];
for (let t = 0; t + step <= total / 16000; t += step) pieces.push([t, t + step]);

for (const threads of values.threads.split(',').map(Number)) {
  const ex = new sherpa.SpeakerEmbeddingExtractor({ model: path.join(voiceModelsDir, EMBEDDINGS[values.model]), numThreads: threads });
  const t0 = performance.now();
  let dim = 0;
  for (const [a, b] of pieces) {
    const s = ex.createStream();
    s.acceptWaveform({ sampleRate: 16000, samples: samples.subarray(Math.floor(a * 16000), Math.floor(b * 16000)) });
    s.inputFinished();
    dim = ex.compute(s).length;
  }
  const seconds = (performance.now() - t0) / 1000;
  console.log(
    `${values.model}, ${threads} thread(s): ${pieces.length} pieces of ${step} s in ${seconds.toFixed(1)} s ` +
      `(${((total / 16000) / seconds).toFixed(0)}× real time), ${dim}-d, rss ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`,
  );
}
