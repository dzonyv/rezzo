/**
 * Ekavian vs ijekavian, counted only on words that actually differ between
 * the two (the reflex of the old yat vowel): vreme/vrijeme, gde/gdje, ...
 * Everything else (jedan, nije, dobije) is the same in both and says nothing.
 */
const PAIRS: [ekavian: string, ijekavian: string][] = [
  ['vreme', 'vrijeme'], ['pre', 'prije'], ['posle', 'poslije'], ['gde', 'gdje'],
  ['mesto', 'mjesto'], ['mestu', 'mjestu'], ['mesta', 'mjesta'],
  ['dete', 'dijete'], ['deca', 'djeca'], ['decu', 'djecu'],
  ['lepo', 'lijepo'], ['lep', 'lijep'], ['lepa', 'lijepa'],
  ['reč', 'riječ'], ['reči', 'riječi'], ['hteo', 'htio'], ['htela', 'htjela'],
  ['vek', 'vijek'], ['veka', 'vijeka'], ['uvek', 'uvijek'], ['dve', 'dvije'], ['deo', 'dio'],
  ['devojka', 'djevojka'], ['pesma', 'pjesma'], ['pesmu', 'pjesmu'],
  ['pobedi', 'pobijedi'], ['pobeda', 'pobjeda'], ['pobedu', 'pobjedu'],
  ['smeh', 'smijeh'], ['belo', 'bijelo'], ['bela', 'bijela'], ['mleko', 'mlijeko'],
  ['celo', 'cijelo'], ['cela', 'cijela'], ['svet', 'svijet'], ['sveta', 'svijeta'], ['svetu', 'svijetu'],
  ['mesec', 'mjesec'], ['meseca', 'mjeseca'], ['nedelja', 'nedjelja'], ['nedelje', 'nedjelje'],
  ['verovatno', 'vjerovatno'], ['veruj', 'vjeruj'], ['verujem', 'vjerujem'],
  ['cena', 'cijena'], ['leto', 'ljeto'], ['sneg', 'snijeg'], ['primer', 'primjer'],
  ['videti', 'vidjeti'], ['sedi', 'sjedi'], ['seti', 'sjeti'], ['seća', 'sjeća'],
  ['mera', 'mjera'], ['rešenje', 'rješenje'], ['uveren', 'uvjeren'], ['bežao', 'bježao'],
];

const EKAVIAN = new Set(PAIRS.map((p) => p[0]));
// "pobjedi" is a common misspelling of "pobijedi"; it is still ijekavian.
const IJEKAVIAN = new Set([...PAIRS.map((p) => p[1]), 'pobjedi']);

/** Counts ekavian and ijekavian forms among normalized (lowercase) words. */
export function yatForms(words: string[]): { ekavian: number; ijekavian: number } {
  let ekavian = 0;
  let ijekavian = 0;
  for (const w of words) {
    if (EKAVIAN.has(w)) ekavian++;
    else if (IJEKAVIAN.has(w)) ijekavian++;
  }
  return { ekavian, ijekavian };
}
