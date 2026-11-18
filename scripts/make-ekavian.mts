/**
 * Makes src/renderer/src/ekavian/words.txt, the ijekavian word forms Rezzo
 * turns into ekavian ones (src/shared/ekavian.ts), from the Serbian Latin
 * Hunspell dictionary that LibreOffice ships. That dictionary has both
 * forms of a word, with the same endings, so a pair is two of its words
 * that differ only where the old yat is: ije or je after a consonant
 * becomes e (vrijeme, vreme; gdje, gde), and a participle's -io becomes
 * -eo (vidio, video). Every ending of the ijekavian word is then matched to
 * the ending of the ekavian one it turns into.
 *
 *   node scripts/make-ekavian.mts
 *
 * Run it again only to change the rules below or the dictionary's version;
 * the output is committed, so building the app doesn't need the network.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { encodeTable } from '../src/shared/ekavian.ts';

/** LibreOffice's dictionaries repository at the last commit that changed Serbian. */
const SOURCE = 'https://raw.githubusercontent.com/LibreOffice/dictionaries/5fe575dbcfeb789e2ab2d9731b88ac0dacc4f453/sr';
const FILES = {
  'sr-Latn.dic': 'f51950195e5bd0aaf155d3488517d4dbc4c8fbc772ecbafbf9131e69a257b1ff',
  'sr-Latn.aff': '38b99cae0005ff20b015d829580a0f3533ffabc1f889a54144a74e90069548e6',
};

/**
 * Words the dictionary doesn't pair, because their two forms are written
 * with different endings or start with a capital there.
 */
const EXTRA: Record<string, string> = {
  voljeti: 'voleti', volio: 'voleo', voljela: 'volela', voljelo: 'volelo', voljeli: 'voleli', voljele: 'volele',
  željeti: 'želeti', želio: 'želeo', željela: 'želela', željelo: 'želelo', željeli: 'želeli', željele: 'želele',
  sjedio: 'sedeo', sjedjeli: 'sedeli', sjedjelo: 'sedelo', sjedjele: 'sedele',
  dio: 'deo', dijela: 'dela', dijelu: 'delu', dijelom: 'delom', dijelovi: 'delovi', dijelova: 'delova', dijelove: 'delove', dijelovima: 'delovima',
  njemački: 'nemački', njemačka: 'nemačka', njemačke: 'nemačke', njemačkoj: 'nemačkoj', njemačku: 'nemačku', njemačkom: 'nemačkom',
  njemačkog: 'nemačkog', njemačkih: 'nemačkih', njemačkim: 'nemačkim',
  nijemac: 'nemac', nijemca: 'nemca', nijemcu: 'nemcu', nijemci: 'nemci', nijemaca: 'nemaca', nijemcima: 'nemcima', nijemce: 'nemce',
};

/**
 * Words left as they are: they're words in ekavian too ("o njem" is "about
 * him"), or their ekavian form depends on the meaning (smijem is smem, "I
 * may", but also smejem, "I laugh").
 */
const KEEP = new Set(['njego', 'njem', 'njezi', 'njemu', 'njega', 'smijem', 'smiješ', 'smije', 'smijemo', 'smijete']);

async function download(name: keyof typeof FILES): Promise<string> {
  const response = await fetch(`${SOURCE}/${name}`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== FILES[name]) throw new Error(`${name}: SHA-256 ${sha}, expected ${FILES[name]}`);
  return bytes.toString('utf8');
}

interface Affix {
  strip: string;
  add: string;
}

/** Hunspell's affix rules as this dictionary writes them: SFX/PFX, a numeric flag, what to strip and what to add. */
function readAffixes(aff: string): { sfx: Map<string, Affix[]>; pfx: Map<string, Affix[]> } {
  const sfx = new Map<string, Affix[]>();
  const pfx = new Map<string, Affix[]>();
  for (const line of aff.split('\n')) {
    const [kind, flag, strip, add] = line.trim().split(/\s+/);
    if ((kind !== 'SFX' && kind !== 'PFX') || !flag || !strip || !add || strip === 'Y' || strip === 'N') continue;
    const rules = kind === 'SFX' ? sfx : pfx;
    rules.set(flag, [...(rules.get(flag) ?? []), { strip: strip === '0' ? '' : strip, add: add === '0' ? '' : add.split('/')[0]! }]);
  }
  return { sfx, pfx };
}

const VOWEL = /[aeiou]/;

/**
 * Where the yat may be: ije or je after a consonant. A word-final nje or
 * lje is left out: there the j belongs to nj or lj (znanje, polje).
 */
function yatSpots(w: string): RegExpMatchArray[] {
  return [...w.matchAll(/ije|je/g)].filter((m) => {
    const i = m.index!;
    if (i === 0 || VOWEL.test(w[i - 1]!)) return false;
    return !(m[0] === 'je' && i + 2 === w.length && /[nl]/.test(w[i - 1]!));
  });
}

/** After n or l the j may belong to nj or lj: njega is "him" as well as ijekavian "care". */
const hasDigraphSpot = (w: string) => yatSpots(w).some((m) => m[0] === 'je' && /[nl]/.test(w[m.index! - 1]!));

/** The ekavian forms `w` could be: any of its yat spots turned into e, and a final -io into -eo. */
function candidates(w: string): Set<string> {
  const spots = yatSpots(w).slice(0, 4);
  const out = new Set<string>();
  for (let mask = 1; mask < 1 << spots.length; mask++) {
    let x = w;
    for (let i = spots.length - 1; i >= 0; i--) {
      if (!(mask & (1 << i))) continue;
      const m = spots[i]!;
      x = x.slice(0, m.index) + 'e' + x.slice(m.index! + m[0].length);
    }
    out.add(x);
  }
  for (const c of [...out, w]) if (c.endsWith('io')) out.add(`${c.slice(0, -2)}eo`);
  out.delete(w);
  return out;
}

function makePairs(dic: string, aff: string): Map<string, string> {
  const { sfx, pfx } = readAffixes(aff);
  const entries = new Map<string, string[]>();
  for (const line of dic.split('\n').slice(1)) {
    const [word, flags = ''] = line.trim().split('/');
    if (word) entries.set(word, [...(entries.get(word) ?? []), flags]);
  }
  const entryForms = (word: string, flags: string): Set<string> => {
    const list = flags.split(',').filter(Boolean);
    const base = [word];
    for (const f of list) for (const r of sfx.get(f) ?? []) if (word.endsWith(r.strip)) base.push(word.slice(0, word.length - r.strip.length) + r.add);
    const out = new Set(base);
    for (const f of list) for (const r of pfx.get(f) ?? []) for (const b of base) out.add(r.add + b);
    return out;
  };
  const formsOf = (word: string) => new Set((entries.get(word) ?? []).flatMap((f) => [...entryForms(word, f)]));

  const pairs = new Map<string, string>();
  const clashes = new Set<string>();
  /** Entries (word/flags) that are one side of a pair; the forms of the rest are words in their own right. */
  const paired = new Set<string>();
  for (const [word, flagSets] of entries) {
    // Capitals are names here (Baljević isn't Balević).
    if (!word.includes('je') || word !== word.toLowerCase()) continue;
    for (const ekavian of candidates(word)) {
      const ekavianFlags = entries.get(ekavian);
      if (!ekavianFlags) continue;
      const target = formsOf(ekavian);
      for (const flags of flagSets) {
        // A j that may be part of nj or lj needs the same endings on both sides to count.
        if (hasDigraphSpot(word) && !ekavianFlags.includes(flags)) continue;
        paired.add(`${word}/${flags}`);
        for (const f of ekavianFlags) paired.add(`${ekavian}/${f}`);
        for (const form of entryForms(word, flags)) {
          if (target.has(form)) continue;
          const hits = [...candidates(form)].filter((c) => target.has(c));
          if (hits.length !== 1) continue;
          if (pairs.has(form) && pairs.get(form) !== hits[0]) clashes.add(form);
          pairs.set(form, hits[0]!);
        }
      }
    }
  }
  for (const form of clashes) pairs.delete(form);

  const plain = new Set<string>();
  for (const [word, flagSets] of entries) for (const f of flagSets) if (!paired.has(`${word}/${f}`)) for (const x of entryForms(word, f)) plain.add(x);
  const ekavianForms = new Set(pairs.values());
  for (const form of [...pairs.keys()]) {
    // An ekavian word in its own right, or one with nj/lj that some other word also has (njemu).
    if (ekavianForms.has(form) || KEEP.has(form) || (hasDigraphSpot(form) && plain.has(form))) pairs.delete(form);
  }
  for (const [from, to] of Object.entries(EXTRA)) pairs.set(from, to);
  return pairs;
}

const [dic, aff] = await Promise.all([download('sr-Latn.dic'), download('sr-Latn.aff')]);
const pairs = makePairs(dic, aff);
const out = path.resolve(import.meta.dirname, '../src/renderer/src/ekavian/words.txt');
writeFileSync(out, encodeTable(pairs));
process.stdout.write(`${pairs.size} word forms -> ${path.relative(process.cwd(), out)}\n`);
