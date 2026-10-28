/**
 * Prepares the material the maintainer corrects by hand:
 *
 *   review/<clip>.txt         draft transcript (large-v3-turbo, the clip's language),
 *                             one segment per line; fix it in place
 *   review/<clip>.labels.txt  Audacity labels on ~20 words at the DTW start;
 *                             drag each one to where the word really begins
 *
 * Existing files are never overwritten, so corrections are safe.
 *
 *   node whisper/make-review.ts
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DRAFT_MODEL, listClips, reviewDir, runsDir } from './clips.ts';
import { toLatin } from './transliterate.ts';
import { wordsOf, type WhisperJson, type Word } from './words.ts';

const LABELS_PER_CLIP = 20;

/** Spread-out words of 4+ letters so labels don't crowd each other. */
function pickWords(words: Word[]): Word[] {
  const candidates = words.filter((w) => w.startDtw !== undefined && w.text.replace(/\P{L}/gu, '').length >= 4);
  if (candidates.length === 0) return [];
  const span = candidates[candidates.length - 1].start - candidates[0].start;
  const gap = span / LABELS_PER_CLIP;
  const picked: Word[] = [];
  for (const w of candidates) {
    if (picked.length === 0 || w.start - picked[picked.length - 1].start >= gap) picked.push(w);
    if (picked.length === LABELS_PER_CLIP) break;
  }
  return picked;
}

async function writeOnce(file: string, content: string) {
  if (existsSync(file)) {
    console.log(`kept ${path.basename(file)} (already exists)`);
    return;
  }
  await writeFile(file, content, 'utf8');
  console.log(`wrote ${path.basename(file)}`);
}

await mkdir(reviewDir, { recursive: true });
for (const clip of listClips()) {
  const lang = clip.lang;
  if (!lang) {
    console.log(`${clip.id}: no language set in clips.json, skipped`);
    continue;
  }
  const json = JSON.parse(await readFile(path.join(runsDir(clip), `${DRAFT_MODEL}__${lang}.json`), 'utf8')) as WhisperJson;

  const lines = json.transcription.map((s) => toLatin(s.text).trim()).filter(Boolean);
  await writeOnce(path.join(reviewDir, `${clip.id}.txt`), `${lines.join('\n')}\n`);

  const labels = pickWords(wordsOf(json)).map((w) => {
    const t = w.startDtw!.toFixed(3);
    return `${t}\t${t}\t${w.text.replace(/[^\p{L}\p{N}]/gu, '')}`;
  });
  await writeOnce(path.join(reviewDir, `${clip.id}.labels.txt`), `${labels.join('\n')}\n`);
}
