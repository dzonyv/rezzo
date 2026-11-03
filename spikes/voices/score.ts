/**
 * Scores the diarization runs in <media>/voices/runs/ against who really
 * talks, and prints one table per audio file plus a summary.
 *
 *   node voices/score.ts
 *
 * Reference: clip D's transcript tagged by speaker (A/M), clip C's speaker
 * labels, and for the one-speaker clips A and B the draft transcript's words.
 * The joined file stitches these together.
 *
 * Measured on 10 ms frames where exactly one reference speaker talks, with
 * 0.25 s around every reference boundary left out (the transcript-based turns
 * are only as exact as whisper's word times):
 *
 *   1:1      share of speech given to the right voice when each voice maps
 *            to at most one person (what the app gets with no help)
 *   merged   the same when every voice maps to the person it mostly covers
 *            (what the app gets once the user merges split voices)
 *   missed   speech that got no voice at all
 *   voices   voices with at least 1 s of speech
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { labelsFromTranscript, parseLabels, type Label } from '../faces/labels.ts';
import { DRAFT_MODEL, listClips, reviewDir, runsDir as whisperRunsDir, type Clip } from '../whisper/clips.ts';
import { wordsOf, type WhisperJson } from '../whisper/words.ts';
import { audioFile, JOINED, joinedParts, readSamples, runsDir, voicesDir, type Run } from './common.ts';

const FRAME = 0.01;
const COLLAR = 0.25;

/** One-speaker clip: speech is wherever the draft transcript has words. */
async function labelsFromWords(clip: Clip, who: string): Promise<Label[]> {
  const draft = JSON.parse(await readFile(path.join(whisperRunsDir(clip), `${DRAFT_MODEL}__${clip.lang}.json`), 'utf8')) as WhisperJson;
  const spans: Label[] = [];
  for (const w of wordsOf(draft)) {
    const last = spans.at(-1);
    if (last && w.start - last.end < 0.5) last.end = Math.max(last.end, w.end);
    else spans.push({ start: w.start, end: w.end, who });
  }
  return spans;
}

async function referenceOf(clip: Clip): Promise<Label[]> {
  const tagged = await labelsFromTranscript(clip);
  if (tagged) return tagged;
  const labelFile = path.join(reviewDir, `${clip.id}.speakers.txt`);
  if (existsSync(labelFile)) return parseLabels(await readFile(labelFile, 'utf8')).filter((l) => l.end > l.start);
  return labelsFromWords(clip, 'X');
}

const clips = new Map(listClips().map((c) => [c.id, c]));
const reference = new Map<string, Label[]>();
for (const [id, clip] of clips) reference.set(id, await referenceOf(clip));
{
  let offset = 0;
  const joined: Label[] = [];
  for (const id of await joinedParts()) {
    for (const l of reference.get(id)!) joined.push({ start: l.start + offset, end: l.end + offset, who: `${id.slice(-1)}:${l.who}` });
    offset += (await readSamples(audioFile(id))).length / 16000;
  }
  reference.set(JOINED, joined);
}

/** Reference speaker per frame: a name, '' for silence, null for overlap or near a boundary. */
function referenceFrames(labels: Label[], seconds: number): (string | null)[] {
  const n = Math.ceil(seconds / FRAME);
  const who: (string | null)[] = new Array(n).fill('');
  const count = new Uint8Array(n);
  for (const l of labels) {
    for (let i = Math.max(0, Math.floor(l.start / FRAME)); i < Math.min(n, Math.ceil(l.end / FRAME)); i++) {
      count[i]++;
      who[i] = l.who;
    }
  }
  for (let i = 0; i < n; i++) if (count[i] > 1) who[i] = null;
  for (const l of labels) {
    for (const edge of [l.start, l.end]) {
      for (let i = Math.max(0, Math.floor((edge - COLLAR) / FRAME)); i < Math.min(n, Math.ceil((edge + COLLAR) / FRAME)); i++) who[i] = null;
    }
  }
  return who;
}

/**
 * Voice per frame, -1 for none. Segments can overlap: pyannote often keeps
 * one voice "on" across a whole stretch while the other one's short turns
 * sit on top of it. The shorter segment is the one that changed, so it wins.
 */
export function voiceFrames(run: Pick<Run, 'segments'>, n: number): number[] {
  const hyp: number[] = new Array(n).fill(-1);
  const length: number[] = new Array(n).fill(Infinity);
  for (const s of run.segments) {
    for (let i = Math.max(0, Math.floor(s.start / FRAME)); i < Math.min(n, Math.ceil(s.end / FRAME)); i++) {
      if (s.end - s.start < length[i]) {
        hyp[i] = s.speaker;
        length[i] = s.end - s.start;
      }
    }
  }
  return hyp;
}

interface Score {
  oneToOne: number;
  merged: number;
  missed: number;
  voices: number;
  people: number;
}

function score(run: Run, labels: Label[]): Score {
  const ref = referenceFrames(labels, run.audioSeconds);
  const hyp = voiceFrames(run, ref.length);
  // Overlap of each voice with each person, in frames.
  const overlap = new Map<number, Map<string, number>>();
  const voiceTotals = new Map<number, number>();
  let speech = 0;
  let missed = 0;
  for (let i = 0; i < ref.length; i++) {
    if (hyp[i] >= 0) voiceTotals.set(hyp[i], (voiceTotals.get(hyp[i]) ?? 0) + 1);
    const r = ref[i];
    if (!r) continue;
    speech++;
    if (hyp[i] < 0) {
      missed++;
      continue;
    }
    const row = overlap.get(hyp[i]) ?? new Map<string, number>();
    row.set(r, (row.get(r) ?? 0) + 1);
    overlap.set(hyp[i], row);
  }
  // 1:1 — greedy on the largest overlaps.
  const cells = [...overlap].flatMap(([v, row]) => [...row].map(([p, n]) => ({ v, p, n }))).sort((a, b) => b.n - a.n);
  const usedV = new Set<number>();
  const usedP = new Set<string>();
  let oneToOne = 0;
  for (const c of cells) {
    if (usedV.has(c.v) || usedP.has(c.p)) continue;
    usedV.add(c.v);
    usedP.add(c.p);
    oneToOne += c.n;
  }
  let merged = 0;
  for (const row of overlap.values()) merged += Math.max(...row.values());
  return {
    oneToOne: oneToOne / speech,
    merged: merged / speech,
    missed: missed / speech,
    voices: [...voiceTotals.values()].filter((n) => n * FRAME >= 1).length,
    people: new Set(labels.map((l) => l.who)).size,
  };
}

const runs: Run[] = [];
for (const f of (await readdir(runsDir)).filter((f) => f.endsWith('.json'))) runs.push(JSON.parse(await readFile(path.join(runsDir, f), 'utf8')) as Run);

const rows = runs.map((r) => ({ audio: r.audio, model: r.model, setting: r.setting, rtf: r.wallSeconds / r.audioSeconds, ...score(r, reference.get(r.audio)!) }));
const pct = (x: number) => `${(100 * x).toFixed(0)}%`.padStart(5);
for (const audio of [...new Set(rows.map((r) => r.audio))].sort()) {
  const people = rows.find((r) => r.audio === audio)!.people;
  console.log(`\n${audio} (${people} speaking)\nmodel           setting   1:1  merged missed voices  speed`);
  for (const r of rows.filter((x) => x.audio === audio).sort((a, b) => a.model.localeCompare(b.model) || a.setting.localeCompare(b.setting))) {
    console.log(`${r.model.padEnd(15)} ${r.setting.padEnd(6)} ${pct(r.oneToOne)} ${pct(r.merged)}  ${pct(r.missed)}  ${String(r.voices).padStart(5)}  ${(1 / r.rtf).toFixed(0)}×`);
  }
}
await writeFile(path.join(voicesDir, 'scores.json'), JSON.stringify(rows, null, 2));
