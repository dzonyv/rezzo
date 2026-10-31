/**
 * Turns whisper.cpp's --output-json-full into transcript segments with
 * per-word timings.
 *
 * Whisper works in sub-word tokens (" Bos" + "ni"). A token that starts with
 * a space begins a new word; punctuation tokens stick to the word before.
 * A word starts at its first token's DTW time (cross-attention alignment,
 * closer to the real onset than the token timestamp; Phase 0 found it about
 * 120 ms late, which Phase 2 corrects) and ends at its last token's end.
 */
import { DTW_START_SHIFT, type Segment, type Word } from '../../shared/project.ts';
import { toLatin } from '../../shared/transliterate.ts';

interface Token {
  /** The token's raw bytes, one Latin-1 character per byte (see readWhisperJson). */
  text: string;
  offsets: { from: number; to: number };
  p: number;
  /** DTW time in 10 ms units; -1 when DTW was off. */
  t_dtw: number;
}

export interface WhisperJson {
  transcription: { text: string; offsets: { from: number; to: number }; tokens: Token[] }[];
}

const isSpecial = (t: Token) => t.text.startsWith('[_') || t.text.startsWith('<|');
const PUNCTUATION = /^\s*[.,!?;:…"'»«„“”()\-–—]+$/;
const round = (s: number) => Math.round(s * 1000) / 1000;

export function segmentsOf(json: WhisperJson): Segment[] {
  const segments: Segment[] = [];

  for (const segment of json.transcription) {
    const words: Word[] = [];
    // Byte-level BPE can split one UTF-8 character across tokens, so the
    // word text is built from bytes and decoded at the end.
    let bytes: number[] = [];
    // Punctuation preceded by a space (an opening quote, a dash) belongs to
    // the word after it, so it waits here until that word starts.
    let pending: number[] = [];
    let current: { start: number; end: number; p: number } | undefined;

    const finish = () => {
      if (current) {
        const text = toLatin(Buffer.from(bytes).toString('utf8')).trim();
        const start = round(current.start);
        if (text) words.push({ text, start, end: Math.max(start, round(current.end)), p: round(current.p) });
      }
      current = undefined;
      bytes = [];
    };

    for (const t of segment.tokens) {
      if (isSpecial(t)) continue;
      const raw = Buffer.from(t.text, 'latin1');
      const tokenBytes = [...raw];

      // Half a character decodes to U+FFFD, which is never punctuation.
      if (PUNCTUATION.test(raw.toString('utf8'))) {
        if (t.text.startsWith(' ') || !current) pending.push(...tokenBytes);
        else bytes.push(...tokenBytes);
        continue;
      }

      if (t.text.startsWith(' ') || !current || pending.length > 0) {
        finish();
        current = {
          start: t.t_dtw >= 0 ? Math.max(0, t.t_dtw / 100 + DTW_START_SHIFT) : t.offsets.from / 1000,
          end: t.offsets.to / 1000,
          p: t.p,
        };
        // "- Da" -> "-Da": drop the word's own leading space after pending punctuation.
        bytes = pending.length > 0 ? [...pending, ...Buffer.from(t.text.trimStart(), 'latin1')] : tokenBytes;
        pending = [];
      } else {
        current.end = t.offsets.to / 1000;
        current.p = Math.min(current.p, t.p);
        bytes.push(...tokenBytes);
      }
    }
    finish();

    if (words.length > 0) {
      segments.push({ start: words[0]!.start, end: Math.max(...words.map((w) => w.end)), words });
    }
  }
  return segments;
}
