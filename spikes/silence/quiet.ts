/**
 * Pauses found from the sound alone, against the word times. gaps.ts showed
 * that most gaps between words aren't quiet; this looks at it from the other
 * side: where the sound really goes quiet, how long for, and whether the
 * transcript puts a word there.
 *
 *   node silence/quiet.ts
 *
 * Loudness is RMS over 20 ms, in dB. Each clip gets its own limit between its
 * noise floor and its speech level, since the clips differ by 15 dB or more.
 * Prints aggregate numbers only.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { audioFile, readSamples } from '../voices/common.ts';
import { DRAFT_MODEL, listClips, runsDir } from '../whisper/clips.ts';
import { wordsOf, type WhisperJson } from '../whisper/words.ts';

const RATE = 16000;
const STEP = 0.02;
const START_SHIFT = -0.1;
/** Where the limit sits between the floor (0) and the speech level (1). */
const LIMITS = [0.25, 0.35, 0.5];
const MIN_PAUSES = [0.3, 0.5, 0.8];
/** A louder moment this short doesn't end a pause (a click, a breath's edge). */
const BRIDGE = 0.06;

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

function loudness(samples: Float32Array): number[] {
  const step = RATE * STEP;
  const out: number[] = [];
  for (let i = 0; i + step <= samples.length; i += step) {
    let sum = 0;
    for (let j = i; j < i + step; j++) sum += samples[j]! * samples[j]!;
    out.push(10 * Math.log10(Math.max(sum / step, 1e-10)));
  }
  return out;
}

function quietRuns(db: number[], limit: number): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let from = -1;
  db.forEach((v, i) => {
    if (v < limit && from < 0) from = i;
    if (v >= limit && from >= 0) {
      runs.push({ start: from * STEP, end: i * STEP });
      from = -1;
    }
  });
  if (from >= 0) runs.push({ start: from * STEP, end: db.length * STEP });
  const joined: { start: number; end: number }[] = [];
  for (const r of runs) {
    const last = joined.at(-1);
    if (last && r.start - last.end <= BRIDGE) last.end = r.end;
    else joined.push({ ...r });
  }
  return joined;
}

for (const clip of listClips()) {
  const json = JSON.parse(await readFile(path.join(runsDir(clip), `${DRAFT_MODEL}__${clip.lang}.json`), 'utf8')) as WhisperJson;
  const words = wordsOf(json).map((w) => {
    const start = Math.max(0, (w.startDtw ?? w.start) + START_SHIFT);
    return { start, end: Math.max(start, w.end) };
  });
  const db = loudness(await readSamples(audioFile(clip.id)));
  const sorted = [...db].sort((a, b) => a - b);
  const floor = percentile(sorted, 0.05);
  const speech = percentile(sorted, 0.8);
  const seconds = db.length * STEP;
  console.log(`\n${clip.id}: ${seconds.toFixed(0)} s, floor ${floor.toFixed(0)} dB, speech ${speech.toFixed(0)} dB, range ${(speech - floor).toFixed(0)} dB`);

  for (const share of LIMITS) {
    const limit = floor + share * (speech - floor);
    const runs = quietRuns(db, limit);
    const parts = MIN_PAUSES.map((min) => {
      const long = runs.filter((r) => r.end - r.start >= min);
      const total = long.reduce((s, r) => s + r.end - r.start, 0);
      // How much of those pauses the transcript says is a word.
      let inWord = 0;
      for (const r of long) for (const w of words) inWord += Math.max(0, Math.min(r.end, w.end) - Math.max(r.start, w.start));
      return `>=${min}: ${long.length} (${total.toFixed(1)} s, ${((total / seconds) * 100).toFixed(0)}%, ${total > 0 ? ((inWord / total) * 100).toFixed(0) : 0}% under words)`;
    });
    console.log(`  limit ${share}: ${parts.join(' | ')}`);
  }
}
