import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { exec, ffmpegExe } from './exec.ts';
import type { JobContext } from './index.ts';

/** Height of a clip card's picture, in pixels; the width follows the source. */
const HEIGHT = 240;

/**
 * One frame of the source at `time`, as a small JPEG, for a clip's card.
 * Seeking before the input is quick and lands on the frame at that time.
 */
export async function makeThumbnail(ctx: JobContext, req: { sourcePath: string; time: number; out: string }): Promise<void> {
  try {
    if ((await stat(req.out)).size > 0) return;
  } catch {
    // not made yet
  }
  await mkdir(path.dirname(req.out), { recursive: true });
  const part = req.out.replace(/\.jpg$/, '.part.jpg');
  try {
    await exec(
      ffmpegExe(),
      ['-y', '-v', 'error', '-ss', req.time.toFixed(3), '-i', req.sourcePath, '-map', '0:v:0', '-frames:v', '1', '-vf', `scale=-2:${HEIGHT}`, '-q:v', '5', part],
      { signal: ctx.signal },
    );
    await rename(part, req.out);
  } catch (e) {
    await rm(part, { force: true });
    throw e;
  }
}
