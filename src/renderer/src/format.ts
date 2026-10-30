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
