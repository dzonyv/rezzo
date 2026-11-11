/** Display formatting shared by the UI. */

/** 3725.4 -> "1:02:05", 65 -> "1:05". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** Time inside a clip, to a tenth of a second: 3.27 -> "0:03.2", 65.04 -> "1:05.0". */
export function formatClipTime(seconds: number): string {
  const tenths = Math.max(0, Math.floor(seconds * 10 + 1e-6));
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`;
}

/**
 * A size on disk in the largest unit it fills, to one decimal past bytes,
 * written as `locale` writes numbers: "7.4 GB", or "7,4 GB".
 */
export function formatBytes(bytes: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  // Rounded as it's shown, so 999.96 MB moves on to "1 GB" and doesn't stay "1000 MB".
  const shown = (value: number, unit: number) => (unit === 0 ? Math.round(value) : Math.round(value * 10) / 10);
  let value = Math.max(0, bytes);
  let unit = 0;
  while (shown(value, unit) >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value);
  return `${number} ${units[unit]}`;
}

/** The locale numbers and dates are written in for an interface language: BCS in Latin script. */
export const localeOf = (language: string): string => (language === 'sh' ? 'sr-Latn' : 'en');

/** [30000, 1001] -> "29.97", [25, 1] -> "25". */
export function formatFrameRate([num, den]: [number, number]): string {
  return String(Math.round((num / den) * 100) / 100);
}

/** "D:\\Video\\Epizoda 12.mp4" -> "Epizoda 12.mp4" */
export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** "D:\\Video\\Epizoda 12.mp4" -> "Epizoda 12" */
export function baseName(path: string): string {
  return fileName(path).replace(/\.[^.]+$/, '');
}
