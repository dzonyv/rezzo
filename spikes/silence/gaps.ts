/**
 * What the gaps between words really are, on the Phase 0 clips: how much time
 * they hold, how many aren't quiet (laughter, music, a word whisper missed),
 * and how far speech runs past the word times, which is the air a cut has to
 * leave around words.
 *
 *   node silence/gaps.ts
 *
 * Words are read the way the app makes them: the DTW start, shifted by
 * DTW_START_SHIFT. Loudness is the highest sample in each 10 ms, the same
 * thing the app has in ClipPlayer.peaks. Prints aggregate numbers only.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { audioFile, readSamples } from '../voices/common.ts';
import { DRAFT_MODEL, listClips, runsDir } from '../whisper/clips.ts';
import { wordsOf, type WhisperJson } from '../whisper/words.ts';

const RATE = 16000;
const STEP = 0.01;
const START_SHIFT = -0.1;
const MIN_GAPS = [0.3, 0.5, 0.8];
/** Below the clip's speech level; a 10 ms step under this counts as quiet. */
const QUIET_DB = [-20, -26, -32];
/** A gap counts as quiet when at most this share of it is louder. */
const LOUD_SHARE = 0.1;

const toDb = (v: number) => 20 * Math.log10(Math.max(v, 1e-6));
const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

function peaksOf(samples: Float32Array): Float32Array {
  const step = RATE * STEP;
  const out = new Float32Array(Math.ceil(samples.length / step));
  for (let i = 0; i < samples.length; i++) {
    const b = Math.floor(i / step);
    const v = Math.abs(samples[i]!);
    if (v > out[b]!) out[b] = v;
  }
  return out;
}

const tails: number[] = [];
const leads: number[] = [];

for (const clip of listClips()) {
  const json = JSON.parse(await readFile(path.join(runsDir(clip), `${DRAFT_MODEL}__${clip.lang}.json`), 'utf8')) as WhisperJson;
  const words = wordsOf(json).map((w) => {
    const start = Math.max(0, (w.startDtw ?? w.start) + START_SHIFT);
    return { start, end: Math.max(start, w.end) };
  });
  const peaks = peaksOf(await readSamples(audioFile(clip.id)));
  const seconds = peaks.length * STEP;
  const at = (t: number) => Math.min(peaks.length, Math.max(0, Math.round(t / STEP)));

  const inWords: number[] = [];
  for (const w of words) for (let i = at(w.start); i < at(w.end); i++) inWords.push(peaks[i]!);
  inWords.sort((a, b) => a - b);
  const speech = percentile(inWords, 0.5);

  const gaps = words.slice(1).map((w, i) => ({ start: words[i]!.end, end: w.start })).filter((g) => g.end > g.start);
  console.log(`\n${clip.id}: ${seconds.toFixed(0)} s, ${words.length} words, speech level ${toDb(speech).toFixed(0)} dBFS`);
  for (const min of MIN_GAPS) {
    const long = gaps.filter((g) => g.end - g.start >= min);
    const total = long.reduce((s, g) => s + g.end - g.start, 0);
    const quiet = QUIET_DB.map((db) => {
      const limit = speech * 10 ** (db / 20);
      const kept = long.filter((g) => {
        const from = at(g.start + 0.15);
        const to = at(g.end - 0.15);
        let loud = 0;
        for (let i = from; i < to; i++) if (peaks[i]! > limit) loud++;
        return to <= from || loud / (to - from) <= LOUD_SHARE;
      });
      const time = kept.reduce((s, g) => s + Math.max(0, g.end - g.start - 0.3), 0);
      return `${db} dB: ${kept.length} quiet, ${time.toFixed(1)} s to cut`;
    });
    console.log(`  gaps >= ${min} s: ${long.length}, ${total.toFixed(1)} s (${((total / seconds) * 100).toFixed(0)}%) | ${quiet.join(' | ')}`);
  }

  // Speech past the word times, at the middle setting: at gaps long enough to see where it stops.
  const limit = speech * 10 ** (QUIET_DB[1]! / 20);
  for (const g of gaps.filter((x) => x.end - x.start >= 0.5)) {
    let tail = at(g.start);
    while (tail < at(g.end) && peaks[tail]! > limit) tail++;
    tails.push((tail - at(g.start)) * STEP);
    let lead = at(g.end);
    while (lead > at(g.start) && peaks[lead - 1]! > limit) lead--;
    leads.push((at(g.end) - lead) * STEP);
  }
}

tails.sort((a, b) => a - b);
leads.sort((a, b) => a - b);
const line = (name: string, v: number[]) => `${name}: median ${percentile(v, 0.5).toFixed(2)} s, 90% ${percentile(v, 0.9).toFixed(2)} s, 95% ${percentile(v, 0.95).toFixed(2)} s`;
console.log(`\nSound running on at gaps of 0.5 s or more (${tails.length} gaps):`);
console.log(`  ${line('after a word ends', tails)}`);
console.log(`  ${line('before a word starts', leads)}`);
