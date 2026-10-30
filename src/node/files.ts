import { rename, writeFile } from 'node:fs/promises';

/** A file name from a name the user typed: no characters Windows refuses, no trailing dots, never empty. */
export function safeFileName(name: string, extension: string, fallback: string): string {
  const base = name.replace(/[<>:"/\\|?*\p{Cc}]/gu, '_').trim().replace(/[. ]+$/, '');
  return `${base || fallback}.${extension}`;
}

/**
 * Writes a file so that a crash halfway never leaves it truncated: the data
 * goes to a temporary file next to it, which then replaces the original.
 */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}
