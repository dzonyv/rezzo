/**
 * Transcript-driven diarization on a whole episode, the way the app will run
 * it: 16 kHz audio, the transcript (large-v3-turbo q5_0 with DTW, as in the
 * app), pieces, embeddings, clustering.
 *
 *   node voices/episode.ts [--threshold 0.7]
 *
 * Episodes are listed in <phase4>/episodes.json ({ "episodes": [{ "id",
 * "file", "lang" }] }), next to the footage and never in the repo. For each
 * one it prints how many voices it finds at several thresholds and how much
 * each voice talks, and writes Audacity labels (<id>/voices.txt) so the
 * result can be checked by ear.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { modelsDir } from '../shared/paths.ts';
import { ffmpegExe } from '../shared/tools.ts';
import { MODELS, whisperCli } from '../whisper/run-matrix.ts';
import { wordsOf, type WhisperJson } from '../whisper/words.ts';
import { EMBEDDINGS, readSamples, voiceModelsDir } from './common.ts';
import { cut, dendrogram, embed, piecesOf, voicesOf, type Piece } from './pipeline.ts';

const phase4Dir = process.env.REZZO_MEDIA_PHASE4 ?? 'D:\\RezzoMedia\\phase4';
const MODEL = 'campplus-zh-en';
const { values } = parseArgs({ options: { threshold: { type: 'string', default: '0.7' } } });
const THRESHOLD = Number(values.threshold);

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code}`))));
  });
}

const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const { episodes } = JSON.parse(await readFile(path.join(phase4Dir, 'episodes.json'), 'utf8')) as { episodes: { id: string; file: string; lang: string }[] };
for (const ep of episodes) {
  const dir = path.join(phase4Dir, ep.id);
  await mkdir(dir, { recursive: true });
  const wav = path.join(dir, 'audio-16k.wav');
  if (!existsSync(wav)) await run(ffmpegExe(), ['-v', 'error', '-y', '-i', ep.file, '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);

  const base = path.join(dir, 'whisper');
  if (!existsSync(`${base}.json`)) {
    const m = MODELS['large-v3-turbo-q5_0'];
    const t0 = performance.now();
    await run(whisperCli, ['-m', path.join(modelsDir, 'whisper', m.file), '-f', wav, '-l', ep.lang, '-t', '8', '-np', '-ojf', '-of', base, '-dtw', m.dtw, '-nfa']);
    console.log(`${ep.id}: transcribed in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  }
  const words: Piece[] = wordsOf(JSON.parse(await readFile(`${base}.json`, 'utf8')) as WhisperJson).map((w) => ({ start: w.start, end: w.end }));

  const samples = await readSamples(wav);
  const seconds = samples.length / 16000;
  const pieces = piecesOf(words);
  const cache = path.join(dir, `embeddings.${MODEL}.json`);
  let vectors: Float32Array[];
  if (existsSync(cache)) {
    vectors = (JSON.parse(await readFile(cache, 'utf8')) as number[][]).map((v) => Float32Array.from(v));
  } else {
    const t0 = performance.now();
    vectors = embed(samples, pieces, path.join(voiceModelsDir, EMBEDDINGS[MODEL]));
    console.log(`${ep.id}: ${pieces.length} pieces embedded in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    await writeFile(cache, JSON.stringify(vectors.map((v) => [...v])));
  }

  const long = pieces.map((_, i) => i).filter((i) => pieces[i].end - pieces[i].start >= 1);
  const t1 = performance.now();
  const merges = dendrogram(long.map((i) => vectors[i]));
  console.log(`${ep.id}: ${time(seconds)} of audio, ${words.length} words, ${pieces.length} pieces (${long.length} ≥ 1 s), clustered in ${((performance.now() - t1) / 1000).toFixed(1)} s`);
  for (const t of [0.5, 0.6, 0.65, 0.7, 0.75, 0.8]) {
    const labels = cut(long.length, merges, { threshold: t });
    const sizes = new Map<number, number>();
    labels.forEach((l, x) => sizes.set(l, (sizes.get(l) ?? 0) + pieces[long[x]].end - pieces[long[x]].start));
    const big = [...sizes.values()].filter((s) => s >= 30).length;
    console.log(`  threshold ${t}: ${sizes.size} voices, ${big} of them with 30 s or more`);
  }
  console.log(`  largest merge distances: ${merges.slice(-8).map((m) => m.distance.toFixed(2)).join(' ')}`);

  const voice = voicesOf(pieces, vectors, { threshold: THRESHOLD });
  const talk = new Map<number, { seconds: number; pieces: number; first: number }>();
  pieces.forEach((p, i) => {
    const t = talk.get(voice[i]) ?? { seconds: 0, pieces: 0, first: p.start };
    t.seconds += p.end - p.start;
    t.pieces++;
    talk.set(voice[i], t);
  });
  console.log(`  at ${THRESHOLD}:`);
  for (const [v, t] of [...talk].sort((a, b) => b[1].seconds - a[1].seconds)) {
    console.log(`    V${v + 1}: ${time(t.seconds)} in ${t.pieces} pieces, first at ${time(t.first)}`);
  }
  // Turns: neighbouring pieces of the same voice joined, for listening.
  const turns: { start: number; end: number; voice: number }[] = [];
  pieces.forEach((p, i) => {
    const last = turns.at(-1);
    if (last && last.voice === voice[i] && p.start - last.end < 1.5) last.end = p.end;
    else turns.push({ start: p.start, end: p.end, voice: voice[i] });
  });
  await writeFile(path.join(dir, 'voices.txt'), turns.map((t) => `${t.start.toFixed(2)}\t${t.end.toFixed(2)}\tV${t.voice + 1}`).join('\n') + '\n');
  console.log(`  ${turns.length} turns written to ${path.join(dir, 'voices.txt')}`);
}
