/**
 * Quick look at the transcription runs before the corrected transcripts exist.
 *
 *   node whisper/precheck.ts
 *
 * Per run: share of Cyrillic in the raw output, word count relative to the
 * clip's median (drops or hallucinations), share of words with č/ć/š/ž/đ
 * (models that lose diacritics stand out), ijekavian forms per 100 words
 * (does the language setting change the dialect?), repeated segments and the
 * auto-detected language.
 */
import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { listClips, runsDir } from './clips.ts';
import { normalize } from './metrics.ts';
import { cyrillicRatio } from './transliterate.ts';
import type { WhisperJson } from './words.ts';

const IJEKAVIAN = /ije|(^|[^i])je(?=[a-zčćšžđ]{2})/;
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

interface Row {
  clip: string;
  run: string;
  words: number;
  cyr: number;
  dia: number;
  ije: number;
  loops: number;
  detected?: string;
}

const rows: Row[] = [];
for (const clip of listClips()) {
  const dir = runsDir(clip);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json'))) {
    const run = file.replace(/\.json$/, '');
    const json = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as WhisperJson;
    const meta = JSON.parse(await readFile(path.join(dir, `${run}.meta.json`), 'utf8'));
    const raw = json.transcription.map((s) => s.text).join('');
    const words = normalize(raw);
    let loops = 0;
    for (let i = 1; i < json.transcription.length; i++) {
      const a = json.transcription[i - 1].text.trim();
      if (a.length > 3 && a === json.transcription[i].text.trim()) loops++;
    }
    rows.push({
      clip: clip.id.split('-')[0],
      run,
      words: words.length,
      cyr: cyrillicRatio(raw),
      dia: words.filter((w) => /[čćšžđ]/.test(w)).length / words.length,
      ije: (100 * words.filter((w) => IJEKAVIAN.test(w)).length) / words.length,
      loops,
      detected: meta.lang === 'auto' ? json.result.language : undefined,
    });
  }
}

const clips = [...new Set(rows.map((r) => r.clip))];
const medians = new Map(clips.map((c) => [c, median(rows.filter((r) => r.clip === c).map((r) => r.words))]));

console.log(`| Run | ${clips.map((c) => `${c}: words / Cyrillic / diacritics / ije per 100`).join(' | ')} | Loops |`);
console.log(`|---|${clips.map(() => '---').join('|')}|---|`);
for (const run of [...new Set(rows.map((r) => r.run))].sort()) {
  const cells = clips.map((c) => {
    const r = rows.find((x) => x.clip === c && x.run === run);
    if (!r) return '–';
    return `${(r.words / medians.get(c)!).toFixed(2)} / ${pct(r.cyr)} / ${pct(r.dia)} / ${r.ije.toFixed(1)}${r.detected ? ` (${r.detected})` : ''}`;
  });
  const loops = rows.filter((r) => r.run === run).reduce((s, r) => s + r.loops, 0);
  console.log(`| ${run} | ${cells.join(' | ')} | ${loops} |`);
}
