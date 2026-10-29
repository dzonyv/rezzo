import { rename, writeFile } from 'node:fs/promises';

/**
 * Writes a file so that a crash halfway never leaves it truncated: the data
 * goes to a temporary file next to it, which then replaces the original.
 */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}
