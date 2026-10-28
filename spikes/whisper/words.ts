/**
 * Turns whisper.cpp's --output-json-full token list into words with timings.
 *
 * Whisper works in sub-word tokens (" Bos" + "ni"). A token that starts with
 * a space begins a new word; punctuation tokens stick to the word before.
 * Each word gets two start times: the regular token timestamp and the DTW
 * one (cross-attention alignment), which is usually closer to the real onset.
 */
import { toLatin } from './transliterate.ts';

export interface Word {
  text: string;
  /** Start from whisper's token timestamps, seconds. */
  start: number;
  end: number;
  /** Start from DTW alignment, seconds; undefined when DTW was off. */
  startDtw: number | undefined;
  /** Lowest token probability in the word. */
  p: number;
}

interface Token {
  text: string;
  offsets: { from: number; to: number };
  p: number;
  t_dtw: number;
}

export interface WhisperJson {
  result: { language: string };
  transcription: { text: string; offsets: { from: number; to: number }; tokens: Token[] }[];
}

const isSpecial = (t: Token) => t.text.startsWith('[_') || t.text.startsWith('<|');

export function wordsOf(json: WhisperJson): Word[] {
  const words: Word[] = [];
  // Byte-level BPE can split one UTF-8 character across tokens, so build the
  // word text from bytes and decode at the end.
  let bytes: number[] = [];
  let current: Omit<Word, 'text'> | undefined;

  const finish = () => {
    if (!current) return;
    const text = toLatin(Buffer.from(bytes).toString('utf8')).trim();
    if (text) words.push({ text, ...current });
    current = undefined;
    bytes = [];
  };

  for (const segment of json.transcription) {
    for (const t of segment.tokens) {
      if (isSpecial(t)) continue;
      const startsWord = t.text.startsWith(' ') || !current;
      const isPunctuation = /^[\s]*[.,!?;:…"'»«„“”)-]+$/.test(t.text);
      if (startsWord && !isPunctuation) {
        finish();
        current = {
          start: t.offsets.from / 1000,
          end: t.offsets.to / 1000,
          startDtw: t.t_dtw >= 0 ? t.t_dtw / 100 : undefined,
          p: t.p,
        };
      } else if (current) {
        current.end = t.offsets.to / 1000;
        current.p = Math.min(current.p, t.p);
      }
      bytes.push(...Buffer.from(t.text, 'utf8'));
    }
  }
  finish();
  return words;
}

/** Full transcript text, transliterated to Latin. */
export function textOf(json: WhisperJson): string {
  return toLatin(json.transcription.map((s) => s.text).join('')).trim();
}
