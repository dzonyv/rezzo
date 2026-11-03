const { readFileSync } = require('node:fs');
const [wav, segmentation, embedding] = process.argv.slice(-3);

const t0 = performance.now();
const sherpa = require('sherpa-onnx-node');
const loadMs = performance.now() - t0;

// 16-bit PCM WAV: walk the chunks to "data".
const buf = readFileSync(wav);
let offset = 12;
let pcm;
while (offset + 8 <= buf.length) {
  const size = buf.readUInt32LE(offset + 4);
  if (buf.toString('ascii', offset, offset + 4) === 'data') {
    pcm = new Int16Array(buf.buffer.slice(buf.byteOffset + offset + 8, buf.byteOffset + offset + 8 + (size & ~1)));
    break;
  }
  offset += 8 + size + (size & 1);
}
const samples = Float32Array.from(pcm, (s) => s / 32768);

const sd = new sherpa.OfflineSpeakerDiarization({
  segmentation: { pyannote: { model: segmentation }, numThreads: 4 },
  embedding: { model: embedding, numThreads: 4 },
  clustering: { numClusters: -1, threshold: 0.5 },
});
const t1 = performance.now();
const segments = sd.process(samples);
process.parentPort.postMessage({
  loadMs: Math.round(loadMs),
  seconds: +((performance.now() - t1) / 1000).toFixed(1),
  audioSeconds: +(samples.length / 16000).toFixed(1),
  segments: segments.length,
  voices: new Set(segments.map((s) => s.speaker)).size,
});
