/**
 * Speaker diarization with sherpa-onnx (pyannote segmentation 3.0 plus a
 * speaker embedding model) on the Phase 0 clips.
 *
 *   node voices/diarize.ts [--models a,b] [--audio clip-d,_all-clips] [--settings n,t0.5] [--threads 4] [--force]
 *
 * For every audio file × embedding model × clustering setting it writes the
 * segments and the time taken to <media>/voices/runs/. Settings: `n` uses
 * the known number of speakers, `t<x>` clusters by cosine distance threshold
 * x without being told how many there are (what the app must do by default).
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { audioFile, EMBEDDINGS, JOINED, readSamples, runPath, runsDir, segmentationModel, SPEAKERS, voiceModelsDir, type Run, type Segment } from './common.ts';

const sherpa = createRequire(import.meta.url)('sherpa-onnx-node') as {
  OfflineSpeakerDiarization: new (config: object) => { sampleRate: number; process(samples: Float32Array): Segment[] };
};

const { values } = parseArgs({
  options: {
    models: { type: 'string', default: Object.keys(EMBEDDINGS).join(',') },
    audio: { type: 'string', default: [...Object.keys(SPEAKERS)].join(',') },
    settings: { type: 'string', default: 'n,t0.3,t0.4,t0.5,t0.6,t0.7,t0.8' },
    threads: { type: 'string', default: '4' },
    force: { type: 'boolean', default: false },
  },
});
const threads = Number(values.threads);
await mkdir(runsDir, { recursive: true });

const audios = new Map<string, Float32Array>();
for (const id of values.audio.split(',')) audios.set(id, await readSamples(audioFile(id === JOINED ? JOINED : id)));

for (const model of values.models.split(',')) {
  for (const setting of values.settings.split(',')) {
    for (const [audio, samples] of audios) {
      const name = setting === 'n' ? `n${SPEAKERS[audio]}` : setting;
      const out = runPath(audio, model, name);
      if (existsSync(out) && !values.force) continue;
      const clustering = setting === 'n' ? { numClusters: SPEAKERS[audio] } : { numClusters: -1, threshold: Number(setting.slice(1)) };
      const sd = new sherpa.OfflineSpeakerDiarization({
        segmentation: { pyannote: { model: segmentationModel }, numThreads: threads },
        embedding: { model: path.join(voiceModelsDir, EMBEDDINGS[model]), numThreads: threads },
        clustering,
        minDurationOn: 0.3,
        minDurationOff: 0.5,
      });
      const t0 = performance.now();
      const segments = sd.process(samples);
      const wallSeconds = (performance.now() - t0) / 1000;
      const run: Run = { audio, model, setting: name, threads, audioSeconds: samples.length / 16000, wallSeconds, segments };
      await writeFile(out, JSON.stringify(run));
      const voices = new Set(segments.map((s) => s.speaker)).size;
      console.log(`${audio.padEnd(11)} ${model.padEnd(15)} ${name.padEnd(5)} ${voices} voice(s), ${segments.length} segments, ${wallSeconds.toFixed(1)} s`);
    }
  }
}
