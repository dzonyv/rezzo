/**
 * Decoding a few frames of the open clip apart from playback (a cover
 * picture, suggested cover frames). The hardware decoder's pool is small
 * and the player already holds a decoder, so only one of these jobs has a
 * decoder of its own at a time; the others wait their turn.
 */
let queue: Promise<unknown> = Promise.resolve();

/** Runs `job` once the jobs before it are done. */
export function withSpareDecoder<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}
