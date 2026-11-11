/**
 * The episode's long jobs as main runs them: shared, stopped when the
 * episode is closed, and limited in time. The media worker is a fake that
 * records each call and lets the test finish it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerError } from '../shared/worker-api.ts';

interface Call {
  method: string;
  options: { signal?: AbortSignal; timeoutMs?: number; onProgress?: (p: unknown) => void };
  resolve(value?: unknown): void;
  reject(e: Error): void;
}
const calls: Call[] = [];

vi.mock('electron', () => ({ dialog: {} }));
vi.mock('node:fs/promises', () => ({ stat: async () => ({ isFile: () => true, size: 100 }) }));
vi.mock('./media-protocol.ts', () => ({ allowMedia: (f: string) => `media:${f}`, rememberSource() {}, sourceUrl: () => 'url' }));
vi.mock('./paths.ts', () => ({ cacheDir: () => 'cache' }));
vi.mock('./settings.ts', () => ({ getSettings: () => ({}) }));
vi.mock('./worker-host.ts', () => ({
  READ_TIMEOUT_MS: 60_000,
  callWorker: (method: string, _args: unknown[], options: Call['options'] = {}) => {
    if (options.signal?.aborted) return Promise.reject(new WorkerError('cancelled before it started', 'cancelled'));
    return new Promise((resolve, reject) => {
      calls.push({ method, options, resolve, reject });
      options.signal?.addEventListener('abort', () => reject(new WorkerError('stopped', 'cancelled')));
    });
  },
}));

const { episodeThumbnail, importEpisode, makePreview, stopEpisodeWork } = await import('./episode.ts');

/** A fingerprint made of one hex digit, so each test has its own episode. */
const fp = (digit: string) => digit.repeat(64);
const source = (fingerprint: string) => ({
  path: `D:/${fingerprint.slice(0, 4)}.mp4`,
  size: 100,
  fingerprint,
  duration: 60,
  video: { codec: 'h264', width: 1920, height: 1080, frameRate: [30, 1], variableFrameRate: false, colorSpace: null },
  audio: null,
});
const sender = () => ({ isDestroyed: () => false, send: vi.fn() });
/** Lets queued promise steps run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  calls.length = 0;
});

describe('the episode preview', () => {
  it('is made once when asked for twice, and both hear how far it is', async () => {
    const [a, b] = [sender(), sender()];
    const first = makePreview(a as never, source(fp('1')));
    const second = makePreview(b as never, source(fp('1')));
    expect(calls.filter((c) => c.method === 'makePreview')).toHaveLength(1);
    calls[0]!.options.onProgress!(0.5);
    expect(a.send).toHaveBeenCalledWith('episode:preview-progress', { fingerprint: fp('1'), fraction: 0.5 });
    expect(b.send).toHaveBeenCalledWith('episode:preview-progress', { fingerprint: fp('1'), fraction: 0.5 });
    calls[0]!.resolve();
    expect(await first).toBe(await second);
  });

  it('stops when its episode is closed, and is made again when it opens again', async () => {
    const stopped = makePreview(sender() as never, source(fp('2')));
    stopEpisodeWork(fp('2'));
    await expect(stopped).rejects.toMatchObject({ code: 'cancelled' });
    void makePreview(sender() as never, source(fp('2')));
    expect(calls.filter((c) => c.method === 'makePreview')).toHaveLength(2);
    expect(calls.at(-1)!.options.signal!.aborted).toBe(false);
  });
});

describe('thumbnails', () => {
  it('each get a time limit, so one that hangs can’t hold up the rest', async () => {
    void episodeThumbnail(source(fp('3')), 1, 'card');
    await settle();
    expect(calls[0]).toMatchObject({ method: 'makeThumbnail', options: { timeoutMs: 30_000 } });
    // Done, so the next test's thumbnails aren't queued behind it.
    calls[0]!.resolve();
  });

  it('waiting their turn are dropped when the episode is closed', async () => {
    const running = episodeThumbnail(source(fp('4')), 1, 'card');
    const waiting = episodeThumbnail(source(fp('4')), 2, 'card');
    await settle();
    expect(calls).toHaveLength(1);
    stopEpisodeWork(fp('4'));
    await expect(running).rejects.toMatchObject({ code: 'cancelled' });
    await expect(waiting).rejects.toMatchObject({ code: 'cancelled' });
    // The one waiting never reached the worker.
    expect(calls).toHaveLength(1);
  });

  it('are made anew when the episode opens again before the stopped ones have gone', async () => {
    const stopped = episodeThumbnail(source(fp('5')), 1, 'card');
    await settle();
    stopEpisodeWork(fp('5'));
    // Asked for again at once: the stopped call hasn't rejected yet.
    const again = episodeThumbnail(source(fp('5')), 1, 'card');
    expect(again).not.toBe(stopped);
    await expect(stopped).rejects.toMatchObject({ code: 'cancelled' });
    await settle();
    const fresh = calls.at(-1)!;
    expect(fresh.options.signal!.aborted).toBe(false);
    // The old one failing didn't drop the new one: asking a third time shares it.
    expect(episodeThumbnail(source(fp('5')), 1, 'card')).toBe(again);
    fresh.resolve();
    await expect(again).resolves.toContain('media:');
  });

  it('are only shared while being made, so one deleted from the cache is made again', async () => {
    const first = episodeThumbnail(source(fp('6')), 1, 'card');
    await settle();
    calls.at(-1)!.resolve();
    await first;
    const before = calls.length;
    void episodeThumbnail(source(fp('6')), 1, 'card');
    await settle();
    // Asked of the worker again, which finds the file there or makes it.
    expect(calls).toHaveLength(before + 1);
    calls.at(-1)!.resolve();
  });
});

describe('importing an episode', () => {
  it('says so when reading the file takes too long', async () => {
    const imported = importEpisode('D:/slow.mp4');
    await settle();
    expect(calls.every((c) => c.options.timeoutMs === 60_000)).toBe(true);
    calls[0]!.reject(new WorkerError('probe took longer than 60 s', 'timeout'));
    calls[1]!.resolve('abc');
    expect(await imported).toEqual({ ok: false, error: 'timeout' });
  });
});
