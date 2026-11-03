/**
 * Speaker labels and audio samples for scoring speaker detection, shared by
 * faces/speakers.ts and voices/score.ts.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DRAFT_MODEL, reviewDir, runsDir, type Clip } from '../whisper/clips.ts';
import { align, normalize, SPEAKER_TAG } from '../whisper/metrics.ts';
import { wordsOf, type WhisperJson } from '../whisper/words.ts';

export interface Label {
  start: number;
  end: number;
  who: string;
}

export const parseLabels = (text: string): Label[] =>
  text
    .split(/\r?\n/)
    .map((l) => l.split('\t'))
    .filter((c) => c.length >= 3 && c[2].trim())
    .map((c) => ({ start: Number(c[0]), end: Number(c[1]), who: c[2].trim().toUpperCase()[0] }));

/**
 * Speaker turns from a corrected transcript whose lines start with a tag
 * ("A: ...", "M: ..."). The lines carry no times, so the transcript is
 * aligned word by word with the draft model's output: each line spans from
 * its first to its last word that found a match.
 */
export async function labelsFromTranscript(clip: Clip): Promise<Label[] | undefined> {
  const refPath = path.join(reviewDir, `${clip.id}.txt`);
  if (!existsSync(refPath)) return undefined;
  const lines = (await readFile(refPath, 'utf8'))
    .split(/\r?\n/)
    .map((line) => ({ who: line.match(SPEAKER_TAG)?.[1], words: normalize(line.replace(SPEAKER_TAG, '')) }));
  if (!lines.some((l) => l.who)) return undefined;

  const ref = lines.flatMap((l, li) => l.words.map((w) => ({ w, li })));
  const draft = JSON.parse(await readFile(path.join(runsDir(clip), `${DRAFT_MODEL}__${clip.lang}.json`), 'utf8')) as WhisperJson;
  const hyp = wordsOf(draft)
    .map((w) => ({ w: normalize(w.text)[0], start: w.startDtw ?? w.start, end: w.end }))
    .filter((h) => h.w);

  const spans = new Map<number, { start: number; end: number }>();
  let i = 0;
  let j = 0;
  for (const op of align(ref.map((r) => r.w), hyp.map((h) => h.w))) {
    if (op.kind === 'ins') {
      j++;
      continue;
    }
    if (op.kind === 'del') {
      i++;
      continue;
    }
    const li = ref[i].li;
    const span = spans.get(li);
    spans.set(li, { start: Math.min(span?.start ?? Infinity, hyp[j].start), end: Math.max(span?.end ?? -Infinity, hyp[j].end) });
    i++;
    j++;
  }
  return [...spans.entries()]
    .filter(([li]) => lines[li].who)
    .map(([li, s]) => ({ start: s.start, end: s.end, who: lines[li].who! }));
}

/**
 * The 16-bit samples of a PCM WAV file. The header isn't always 44 bytes:
 * FFmpeg adds a LIST chunk, so walk the chunks until "data".
 */
export function pcmSamples(wav: Buffer): Int16Array {
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === 'data') {
      const start = offset + 8;
      const length = Math.min(size, wav.length - start) & ~1;
      // Copy so the samples start on a 2-byte boundary whatever the offset.
      return new Int16Array(wav.buffer.slice(wav.byteOffset + start, wav.byteOffset + start + length));
    }
    offset += 8 + size + (size & 1);
  }
  throw new Error('WAV file has no data chunk');
}
