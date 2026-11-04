import { rename, rm, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

/** A file name from a name the user typed: no characters Windows refuses, no trailing dots, never empty. */
export function safeFileName(name: string, extension: string, fallback: string): string {
  const base = name.replace(/[<>:"/\\|?*\p{Cc}]/gu, '_').trim().replace(/[. ]+$/, '');
  return `${base || fallback}.${extension}`;
}

/** Windows won't replace a file for the moment someone else has it open. */
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_TRIES = 6;

async function replaceFile(tmp: string, file: string): Promise<void> {
  for (let tries = 1; ; tries++) {
    try {
      await rename(tmp, file);
      return;
    } catch (e) {
      if (tries === RENAME_TRIES || !BUSY.has((e as NodeJS.ErrnoException).code ?? '')) throw e;
      await sleep(tries * 20);
    }
  }
}

let writes = 0;

/**
 * Writes a file so that a crash halfway never leaves it truncated: the data
 * goes to a temporary file next to it, which then replaces the original.
 * Every write has its own temporary file: two at once in one process would
 * otherwise write into the same one, and the second to finish finds it gone.
 */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${file}.${process.pid}.${++writes}.tmp`;
  await writeFile(tmp, data);
  try {
    await replaceFile(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}
