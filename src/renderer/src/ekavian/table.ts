/**
 * The ijekavian-to-ekavian word list (made by scripts/make-ekavian.mts),
 * loaded the first time it's needed: about a megabyte that most sessions
 * read once, after a transcription.
 */
import { decodeTable, type EkavianTable } from '../../../shared/ekavian.ts';

let table: Promise<EkavianTable> | undefined;

export function loadEkavian(): Promise<EkavianTable> {
  table ??= import('./words.txt?raw').then((m) => decodeTable(m.default));
  return table;
}
