import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

const SAMPLE = 4 << 20;

/**
 * A content hash that is quick even for a two-hour episode: SHA-256 over the
 * file size and its first and last 4 MiB. It tells "the same video, moved"
 * from "a different video" when relinking, and keys the cache.
 */
export async function fingerprint(file: string): Promise<string> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const hash = createHash('sha256').update(`rezzo-fingerprint-1:${size}:`);
    const head = Buffer.alloc(Math.min(SAMPLE, size));
    await handle.read(head, 0, head.length, 0);
    hash.update(head);
    if (size > SAMPLE) {
      const tailStart = Math.max(SAMPLE, size - SAMPLE);
      const tail = Buffer.alloc(size - tailStart);
      await handle.read(tail, 0, tail.length, tailStart);
      hash.update(tail);
    }
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}
