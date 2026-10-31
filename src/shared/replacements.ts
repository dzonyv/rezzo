/**
 * The replacement list: words Whisper always gets wrong ("futbal" for
 * "fudbal"), fixed after transcription so their timings stay. Prompts
 * can't fix them and make the rest worse (spikes/REPORT.md, 0a).
 *
 * A rule matches a whole word, ignoring case and the punctuation around
 * it but not diacritics. A `*` at the end of `from` matches any ending,
 * which is kept: "futbal*" -> "fudbal*" turns "Futbala," into "Fudbala,".
 * The word keeps its capitals (Futbal -> Fudbal, FUTBAL -> FUDBAL), and a
 * lowercase one takes the replacement as written (names stay capitalised); a
 * replacement with spaces becomes several words, an empty one deletes it.
 */
import { z } from 'zod';
import type { Segment } from './project.ts';
import { setWordText } from './transcript-edit.ts';
import { toLatin } from './transliterate.ts';

export const replacementSchema = z.object({
  from: z.string().trim().min(1).max(100),
  to: z.string().trim().max(200),
});
export type Replacement = z.infer<typeof replacementSchema>;

/** Punctuation before, the word itself, punctuation after. */
const PARTS = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su;

const key = (text: string) => toLatin(text).normalize('NFC').toLowerCase();

const isUpper = (s: string) => s === s.toUpperCase() && s !== s.toLowerCase();

/** `text` written with the capitals of `like`. */
function withCaseOf(like: string, text: string): string {
  if ([...like].length > 1 && isUpper(like)) return text.toUpperCase();
  const first = [...like][0];
  return first && isUpper(first) ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** A word without the punctuation around it. */
export function wordCore(text: string): string {
  return PARTS.exec(text)?.[2] ?? '';
}

/**
 * The rule that would have made a correction by itself, for offering to
 * add it to the list, or null when there's nothing to learn (no change, a
 * deletion). A capital both words share, as at the start of a sentence,
 * isn't part of the rule.
 */
export function ruleFor(before: string, after: string): Replacement | null {
  const from = wordCore(before);
  let to = wordCore(after.trim());
  if (!from || !to || key(from) === key(to)) return null;
  const capital = (s: string) => isUpper([...s][0] ?? '');
  if (capital(from) && capital(to)) to = to.charAt(0).toLowerCase() + to.slice(1);
  return { from: key(from), to };
}

/** The first rule's result for a word, or null when no rule matches. */
export function replaceWord(text: string, rules: readonly Replacement[]): string | null {
  const [, before = '', word = '', after = ''] = PARTS.exec(text) ?? [];
  if (!word) return null;
  const lower = key(word);
  for (const rule of rules) {
    const prefix = rule.from.endsWith('*');
    const from = key(prefix ? rule.from.slice(0, -1) : rule.from);
    if (!from || (prefix ? !lower.startsWith(from) : lower !== from)) continue;
    const to = toLatin(rule.to.replace(/\*$/, '')).normalize('NFC');
    // The ending is taken from the word as written, so its case survives.
    const ending = prefix ? [...word.normalize('NFC')].slice([...from].length).join('') : '';
    const replaced = withCaseOf(word, to) + ending;
    return replaced.trim() ? before + replaced + after : '';
  }
  return null;
}

/**
 * Applies the rules to every word, in place (see transcript-edit.ts), and
 * returns how many words they changed.
 */
export function applyReplacements(segments: Segment[], rules: readonly Replacement[]): number {
  if (rules.length === 0) return 0;
  let changed = 0;
  // Backwards, so splitting or deleting a word doesn't move the ones still to do.
  for (let s = segments.length - 1; s >= 0; s--) {
    for (let w = segments[s]!.words.length - 1; w >= 0; w--) {
      const text = segments[s]!.words[w]!.text;
      const next = replaceWord(text, rules);
      if (next === null || next === text) continue;
      setWordText(segments, { segment: s, word: w }, next);
      changed++;
    }
  }
  return changed;
}
