/**
 * The ijekavian-to-ekavian word list (made by scripts/make-ekavian.mts),
 * about a megabyte, loaded once a project has a transcript, so it's
 * usually there before anyone makes a choice that needs it.
 */
import { decodeTable, type EkavianTable } from '../../../shared/ekavian.ts';

let table: Promise<EkavianTable> | undefined;
let loaded: EkavianTable | null = null;

export function loadEkavian(): Promise<EkavianTable> {
  table ??= import('./words.txt?raw').then(
    (m) => (loaded = decodeTable(m.default)),
    (e: unknown) => {
      // Tried again next time rather than failing for the rest of the session.
      table = undefined;
      throw e;
    },
  );
  return table;
}

/** The list if it has loaded, so an edit doesn't have to wait for it. */
export const ekavianNow = (): EkavianTable | null => loaded;
