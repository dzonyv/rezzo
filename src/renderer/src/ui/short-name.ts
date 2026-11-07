/**
 * Two or three characters standing for a project in a list: its number
 * when the name has one ("Episode 47" → "47"), otherwise the first letters
 * of its first two words ("Mostar special" → "MS").
 */
export function shortName(name: string): string {
  const numbers = name.match(/\d+/g);
  const last = numbers?.at(-1);
  if (last && last.length <= 3) return last;
  const words = name.match(/\p{L}[\p{L}\p{M}]*/gu) ?? [];
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toLocaleUpperCase();
  if (words.length === 1) return words[0]!.slice(0, 2).toLocaleUpperCase();
  return last ? last.slice(-3) : '·';
}
