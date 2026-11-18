/**
 * Ekavian transcripts. Whisper, told `sr`, sometimes writes ekavian speech
 * as ijekavian (gde as gdje, veštine as vještine), so Rezzo turns those
 * words back, from a list of word forms made out of a free Serbian
 * dictionary (scripts/make-ekavian.mts). Whether a person's words are
 * turned is up to the user, per voice: a guest who speaks ijekavian keeps
 * it.
 *
 * A word that was turned remembers how Whisper wrote it (`spoken`), so it
 * can go back. Words the user typed (`typed`, see transcript-edit.ts) are
 * never turned, either way.
 */
import type { Project, Segment, Word } from './project.ts';
import { PARTS, withCaseOf } from './replacements.ts';

/** How a transcript is written: ekavian where Whisper wrote ijekavian, or as Whisper wrote it. */
export type Speech = Project['speech'];

/** Ijekavian word form, lowercase, to its ekavian form. */
export type EkavianTable = ReadonlyMap<string, string>;

const MAX_SHARED = 35;

function shared(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && i < MAX_SHARED && a[i] === b[i]) i++;
  return i;
}

/**
 * The table as text, small enough to ship: one pair a line, sorted, each
 * word written as how many letters it shares (one base-36 digit) with the
 * word before it, the ijekavian one with the line above and the ekavian
 * one with its ijekavian one, then the rest:
 *
 *   0gdje 2e      gdje -> gde
 *   4god 2egod    gdjegod -> gdegod
 */
export function encodeTable(table: EkavianTable): string {
  let previous = '';
  const lines = ['# Ijekavian word forms and their ekavian ones, made by scripts/make-ekavian.mts. See src/shared/ekavian.ts.'];
  for (const [from, to] of [...table].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const a = shared(previous, from);
    const b = shared(from, to);
    lines.push(`${a.toString(36)}${from.slice(a)} ${b.toString(36)}${to.slice(b)}`);
    previous = from;
  }
  return `${lines.join('\n')}\n`;
}

export function decodeTable(text: string): EkavianTable {
  const table = new Map<string, string>();
  let previous = '';
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const space = line.indexOf(' ');
    const from = previous.slice(0, parseInt(line[0]!, 36)) + line.slice(1, space);
    const to = from.slice(0, parseInt(line[space + 1]!, 36)) + line.slice(space + 2).trimEnd();
    table.set(from, to);
    previous = from;
  }
  return table;
}

/** A word's text in ekavian, punctuation and capitals kept, or null when it's the same. */
export function ekavianOf(text: string, table: EkavianTable): string | null {
  const [, before = '', word = '', after = ''] = PARTS.exec(text) ?? [];
  const to = word && table.get(word.normalize('NFC').toLowerCase());
  return to ? before + withCaseOf(word, to) + after : null;
}

/** Whether a voice's words are ekavian: its own choice, or the project's when it has none. */
export const isEkavian = (own: boolean | null | undefined, speech: Speech): boolean => own ?? speech === 'ekavian';

/** What a word becomes if it is to be ekavian (or not), or null when it stays as it is. */
function rewritten(word: Word, ekavian: boolean, table: EkavianTable): Pick<Word, 'text' | 'spoken'> | null {
  if (ekavian && word.spoken === undefined && !word.typed) {
    const text = ekavianOf(word.text, table);
    return text === null ? null : { text, spoken: word.text };
  }
  if (!ekavian && word.spoken !== undefined) return { text: word.spoken, spoken: undefined };
  return null;
}

/** A word's text once it's written ekavian (or not). */
export const textAfter = (word: Word, ekavian: boolean, table: EkavianTable): string => rewritten(word, ekavian, table)?.text ?? word.text;

/**
 * Writes each word the way `ekavianFor` says it should be, in place, and
 * returns how many changed: ekavian (remembering how Whisper wrote it) or
 * back as Whisper wrote it.
 *
 * The words are read from `read` (the same transcript, not a draft, by
 * default `segments` itself) and only the ones that change are written to
 * `segments`: on an Immer draft of an hour-long transcript that's a small
 * undo step, and nothing is drafted when nothing changes.
 */
export function writeSpeech(
  segments: Segment[],
  ekavianFor: (word: Word) => boolean,
  table: EkavianTable,
  read: readonly Segment[] = segments,
): number {
  let changed = 0;
  read.forEach((segment, s) =>
    segment.words.forEach((word, w) => {
      const next = rewritten(word, ekavianFor(word), table);
      if (!next) return;
      const target = segments[s]!.words[w]!;
      target.text = next.text;
      if (next.spoken === undefined) delete target.spoken;
      else target.spoken = next.spoken;
      changed++;
    }),
  );
  return changed;
}

/** How many words `writeSpeech` would change, without changing them. */
export function speechChanges(segments: readonly Segment[], ekavianFor: (word: Word) => boolean, table: EkavianTable): number {
  let changed = 0;
  for (const segment of segments) for (const word of segment.words) if (rewritten(word, ekavianFor(word), table)) changed++;
  return changed;
}
