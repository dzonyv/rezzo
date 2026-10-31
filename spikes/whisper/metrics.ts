/**
 * Scores every transcription run against the maintainer's corrected
 * transcripts and word timings.
 *
 *   node whisper/metrics.ts [--clips id,id] [--shift-sweep model]
 *
 * --shift-sweep prints how a constant shift of that model's DTW word starts
 * would score, instead of the usual tables.
 *
 * Pass --clips to score only clips whose transcripts have been corrected;
 * uncorrected drafts would make the draft model look perfect.
 *
 * Per run: WER and CER on normalized text, diacritic errors (a word that is
 * right except for č/ć/š/ž/đ), share of Cyrillic in Whisper's raw output, and
 * word-start error against the corrected Audacity labels (regular and DTW).
 * Writes <media>/whisper/metrics.json and prints summary tables.
 */
import { existsSync, readdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DRAFT_MODEL, listClips, reviewDir, runsDir, whisperDir, type Clip } from './clips.ts';
import { cyrillicRatio, toLatin } from './transliterate.ts';
import { wordsOf, type WhisperJson, type Word } from './words.ts';

/** Speaker tags the maintainer may put at the start of a line ("A: ...", "M:..."). */
export const SPEAKER_TAG = /^\s*(\p{Lu}{1,3})\s*:\s*/u;

/** Reference text without speaker tags, which would otherwise count as words. */
export const stripSpeakerTags = (text: string) =>
  text.split(/\r?\n/).map((line) => line.replace(SPEAKER_TAG, '')).join('\n');

export function normalize(text: string): string[] {
  return toLatin(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Drops diacritics the way people type without them: č/ć -> c, đ -> d (dj too). */
export const stripDiacritics = (w: string) =>
  w.replace(/dj/g, 'd').replace(/[čć]/g, 'c').replace(/š/g, 's').replace(/ž/g, 'z').replace(/đ/g, 'd');

type Op = { kind: 'ok' | 'sub' | 'del' | 'ins'; ref?: string; hyp?: string };

/** Minimum-edit alignment of two token sequences with a backtrace. */
export function align(ref: string[], hyp: string[]): Op[] {
  const n = ref.length;
  const m = hyp.length;
  const d: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    }
  }
  const ops: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) {
      ops.push({ kind: ref[i - 1] === hyp[j - 1] ? 'ok' : 'sub', ref: ref[i - 1], hyp: hyp[j - 1] });
      i--;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ kind: 'del', ref: ref[i - 1] });
      i--;
    } else {
      ops.push({ kind: 'ins', hyp: hyp[j - 1] });
      j--;
    }
  }
  return ops.reverse();
}

const editDistance = (a: string[], b: string[]) => align(a, b).filter((o) => o.kind !== 'ok').length;

interface Label {
  time: number;
  word: string;
}

function parseLabels(text: string): Label[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.split('\t'))
    .filter((cols) => cols.length >= 3 && cols[2].trim())
    .map((cols) => ({ time: Number(cols[0]), word: normalize(cols[2])[0] ?? '' }))
    .filter((l) => Number.isFinite(l.time) && l.word);
}

/** For each labelled word, the same word in the run whose start is closest (within 1 s). */
function timingErrors(labels: Label[], words: Word[]) {
  const regular: number[] = [];
  const dtw: number[] = [];
  for (const label of labels) {
    let best: Word | undefined;
    for (const w of words) {
      if (normalize(w.text)[0] !== label.word) continue;
      if (Math.abs(w.start - label.time) > 1) continue;
      if (!best || Math.abs(w.start - label.time) < Math.abs(best.start - label.time)) best = w;
    }
    if (!best) continue;
    regular.push((best.start - label.time) * 1000);
    if (best.startDtw !== undefined) dtw.push((best.startDtw - label.time) * 1000);
  }
  return { matched: regular.length, labels: labels.length, regular, dtw };
}

const median = (xs: number[]) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const within = (xs: number[], ms: number) => (xs.length ? xs.filter((x) => Math.abs(x) <= ms).length / xs.length : NaN);

/** Consecutive identical segments: Whisper's typical repetition loop. */
function repeatedSegments(json: WhisperJson): number {
  let count = 0;
  for (let i = 1; i < json.transcription.length; i++) {
    const a = json.transcription[i - 1].text.trim();
    if (a.length > 3 && a === json.transcription[i].text.trim()) count++;
  }
  return count;
}

async function scoreClip(clip: Clip) {
  const refPath = path.join(reviewDir, `${clip.id}.txt`);
  if (!existsSync(refPath)) return [];
  const refText = stripSpeakerTags(await readFile(refPath, 'utf8'));
  const ref = normalize(refText);
  const refChars = [...ref.join(' ')];
  const labelsPath = path.join(reviewDir, `${clip.id}.labels.txt`);
  const labelsText = existsSync(labelsPath) ? await readFile(labelsPath, 'utf8') : '';
  // make-review writes 3 decimals, Audacity's export writes 6. A file still in
  // our format was never reviewed, and its labels would score the draft model
  // as perfect.
  const reviewed = /^\d+\.\d{6}\t/m.test(labelsText);
  const labels = reviewed ? parseLabels(labelsText) : [];
  // Labels start at the draft model's DTW time. The ones the maintainer left in
  // place were judged right, which flatters the draft model; the moved ones are
  // the honest sample of timing error.
  const draftJson = JSON.parse(await readFile(path.join(runsDir(clip), `${DRAFT_MODEL}__${clip.lang}.json`), 'utf8')) as WhisperJson;
  const draftWords = wordsOf(draftJson);
  const moved = labels.filter((l) => !draftWords.some((w) => normalize(w.text)[0] === l.word && w.startDtw !== undefined && Math.abs(w.startDtw - l.time) < 0.0015));

  const rows = [];
  for (const file of readdirSync(runsDir(clip)).filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json'))) {
    const run = file.replace(/\.json$/, '');
    const json = JSON.parse(await readFile(path.join(runsDir(clip), file), 'utf8')) as WhisperJson;
    const meta = JSON.parse(await readFile(path.join(runsDir(clip), `${run}.meta.json`), 'utf8'));
    const rawText = json.transcription.map((s) => s.text).join('');
    const hyp = normalize(rawText);
    const ops = align(ref, hyp);
    const errors = ops.filter((o) => o.kind !== 'ok');
    const subs = ops.filter((o) => o.kind === 'sub');
    const diacritic = subs.filter((o) => stripDiacritics(o.ref!) === stripDiacritics(o.hyp!));
    const timing = timingErrors(labels, wordsOf(json));
    const movedTiming = timingErrors(moved, wordsOf(json));

    rows.push({
      clip: clip.id,
      spokenLang: clip.lang,
      run,
      model: meta.model as string,
      lang: meta.lang as string,
      prompt: meta.prompt as boolean,
      detectedLanguage: meta.detectedLanguage?.lang as string | undefined,
      refWords: ref.length,
      wer: errors.length / ref.length,
      werWithoutDiacritics: (errors.length - diacritic.length) / ref.length,
      cer: editDistance(refChars, [...hyp.join(' ')]) / refChars.length,
      diacriticErrors: diacritic.length,
      diacriticRate: diacritic.length / ref.length,
      cyrillic: cyrillicRatio(rawText),
      insertions: ops.filter((o) => o.kind === 'ins').length,
      deletions: ops.filter((o) => o.kind === 'del').length,
      repeatedSegments: repeatedSegments(json),
      substitutions: subs.filter((o) => !diacritic.includes(o)).map((o) => `${o.ref}→${o.hyp}`),
      diacriticSubstitutions: diacritic.map((o) => `${o.ref}→${o.hyp}`),
      timing: {
        matched: `${timing.matched}/${timing.labels}`,
        regular: { medianAbsMs: median(timing.regular.map(Math.abs)), within100: within(timing.regular, 100), within200: within(timing.regular, 200) },
        dtw: { medianAbsMs: median(timing.dtw.map(Math.abs)), within100: within(timing.dtw, 100), within200: within(timing.dtw, 200) },
        rawRegularMs: timing.regular.map(Math.round),
        rawDtwMs: timing.dtw.map(Math.round),
        movedDtwMs: movedTiming.dtw.map(Math.round),
      },
      wallMs: meta.wallMs as number,
    });
  }
  return rows;
}

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '–');

/**
 * How a constant shift of the DTW starts would score: for each shift, the
 * signed median and the share within 100/200 ms, over all reviewed labels
 * and over the moved ones. Uses the app's model in each clip's language.
 */
function printShiftSweep(rows: Awaited<ReturnType<typeof scoreClip>>, model: string) {
  const picked = rows.filter((r) => r.run === `${model}__${r.spokenLang}`);
  const all = picked.flatMap((r) => r.timing.rawDtwMs);
  const moved = picked.flatMap((r) => r.timing.movedDtwMs);
  console.log(`\nShift sweep for ${model} (${picked.map((r) => r.clip).join(', ')}; ${all.length} labels, ${moved.length} moved)\n`);
  console.log('| Shift | All: signed median | All: within 100 / 200 ms | Moved: signed median | Moved: within 100 / 200 ms |');
  console.log('|---|---|---|---|---|');
  for (let shift = -200; shift <= 0; shift += 10) {
    const a = all.map((x) => x + shift);
    const m = moved.map((x) => x + shift);
    console.log(`| ${shift} ms | ${Math.round(median(a))} ms | ${pct(within(a, 100))} / ${pct(within(a, 200))} | ${Math.round(median(m))} ms | ${pct(within(m, 100))} / ${pct(within(m, 200))} |`);
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { clips: { type: 'string' }, 'shift-sweep': { type: 'string' } } });
  const only = values.clips?.split(',');
  const clips = listClips().filter((c) => !only || only.includes(c.id));
  const rows = (await Promise.all(clips.map(scoreClip))).flat();
  if (values['shift-sweep']) {
    printShiftSweep(rows, values['shift-sweep']);
    process.exit(0);
  }
  await writeFile(path.join(whisperDir, 'metrics.json'), JSON.stringify(rows, null, 2));

  // Pooled over clips, weighted by reference length.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) groups.set(r.run, [...(groups.get(r.run) ?? []), r]);
  const pooled = [...groups.entries()].map(([run, rs]) => {
    const words = rs.reduce((s, r) => s + r.refWords, 0);
    const sum = (f: (r: (typeof rs)[number]) => number) => rs.reduce((s, r) => s + f(r) * r.refWords, 0) / words;
    const dtw = rs.flatMap((r) => r.timing.rawDtwMs);
    const movedDtw = rs.flatMap((r) => r.timing.movedDtwMs);
    const regular = rs.flatMap((r) => r.timing.rawRegularMs);
    return {
      run, clips: rs.length, wer: sum((r) => r.wer), werNoDia: sum((r) => r.werWithoutDiacritics), cer: sum((r) => r.cer),
      dia: sum((r) => r.diacriticRate), cyr: Math.max(...rs.map((r) => r.cyrillic)), loops: rs.reduce((s, r) => s + r.repeatedSegments, 0),
      regMed: median(regular.map(Math.abs)), reg200: within(regular, 200), dtwMed: median(dtw.map(Math.abs)), dtw200: within(dtw, 200),
      movedSigned: median(movedDtw), movedN: movedDtw.length,
    };
  }).sort((a, b) => a.wer - b.wer);

  console.log('| Run | WER | WER ignoring diacritics | CER | Diacritic errors | Max Cyrillic | Loops | Start error median (regular / DTW) | Within 200 ms (regular / DTW) | Moved labels: DTW signed median |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const p of pooled) {
    console.log(`| ${p.run} | ${pct(p.wer)} | ${pct(p.werNoDia)} | ${pct(p.cer)} | ${pct(p.dia)} | ${pct(p.cyr)} | ${p.loops} | ${Math.round(p.regMed)} / ${Math.round(p.dtwMed)} ms | ${pct(p.reg200)} / ${pct(p.dtw200)} | ${Math.round(p.movedSigned)} ms (n=${p.movedN}) |`);
  }
}
