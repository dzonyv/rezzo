/**
 * Serbian Cyrillic -> Gaj's Latin transliteration.
 *
 * Whisper often answers in Cyrillic when the language is set to `sr`, while
 * Rezzo always shows Latin. The mapping is one-to-one except for three
 * letters that become two Latin letters (Љ -> Lj, Њ -> Nj, Џ -> Dž); their
 * casing depends on the neighbours: "Љубав" -> "Ljubav", "ЉУБАВ" -> "LJUBAV".
 */

const LOWER: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'đ', е: 'e', ж: 'ž', з: 'z',
  и: 'i', ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', ћ: 'ć', у: 'u', ф: 'f', х: 'h', ц: 'c',
  ч: 'č', џ: 'dž', ш: 'š',
};

const isLetter = (ch: string | undefined): boolean => ch !== undefined && /\p{L}/u.test(ch);
const isUpper = (ch: string | undefined): boolean =>
  isLetter(ch) && ch === ch!.toUpperCase() && ch !== ch!.toLowerCase();

export function toLatin(input: string): string {
  // NFC first: Whisper's byte-level tokens can produce decomposed letters
  // (c + combining caron) that look right but don't compare equal to "č".
  const chars = Array.from(input.normalize('NFC'));
  let out = '';

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const lower = ch.toLowerCase();
    const latin = LOWER[lower];

    if (latin === undefined) {
      out += ch;
      continue;
    }
    if (ch === lower) {
      out += latin;
      continue;
    }
    if (latin.length === 1) {
      out += latin.toUpperCase();
      continue;
    }

    // Uppercase digraph: all caps inside an all-caps word, title case otherwise.
    const next = chars[i + 1];
    const prev = chars[i - 1];
    const allCaps = isUpper(next) || (!isLetter(next) && isUpper(prev));
    out += allCaps ? latin.toUpperCase() : latin[0].toUpperCase() + latin.slice(1);
  }

  return out;
}

/** Share of letters in `text` that are Cyrillic (0..1). Used to measure Whisper's script choice. */
export function cyrillicRatio(text: string): number {
  let letters = 0;
  let cyrillic = 0;
  for (const ch of text) {
    if (!isLetter(ch)) continue;
    letters++;
    if (/\p{Script=Cyrillic}/u.test(ch)) cyrillic++;
  }
  return letters === 0 ? 0 : cyrillic / letters;
}
