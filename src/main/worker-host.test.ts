import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The media worker's process: records what it's sent. */
class FakeWorker extends EventEmitter {
  sent: { type: string; id: number }[] = [];
  postMessage(message: { type: string; id: number }) {
    this.sent.push(message);
  }
  kill() {}
}

const forked: FakeWorker[] = [];
vi.mock('electron', () => ({
  utilityProcess: {
    fork: () => {
      const worker = new FakeWorker();
      forked.push(worker);
      return worker;
    },
  },
}));
vi.mock('../workers/media/index.ts?modulePath', () => ({ default: 'worker.js' }));
vi.mock('./paths.ts', () => ({ ffmpegBinDir: () => 'bin' }));

const { callWorker, holding, inUse, stopWorker } = await import('./worker-host.ts');

beforeEach(() => {
  stopWorker();
  forked.length = 0;
});

describe('callWorker', () => {
  it('never starts a call whose signal is aborted already', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(callWorker('fingerprint', ['a.mp4'], { signal: abort.signal })).rejects.toMatchObject({ code: 'cancelled' });
    expect(forked).toHaveLength(0);
  });

  it('tells the worker when a running call is aborted', async () => {
    const abort = new AbortController();
    const call = callWorker('fingerprint', ['a.mp4'], { signal: abort.signal });
    const worker = forked[0]!;
    const { id } = worker.sent[0]!;
    abort.abort();
    expect(worker.sent).toEqual([{ type: 'call', id, method: 'fingerprint', args: ['a.mp4'] }, { type: 'cancel', id }]);
    worker.emit('message', { type: 'error', id, message: 'stopped', code: 'cancelled' });
    await expect(call).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('fails a call that runs out of time, tells the worker, and ignores its late answer', async () => {
    vi.useFakeTimers();
    try {
      const call = callWorker('fingerprint', ['a.mp4'], { timeoutMs: 1000 });
      const failed = expect(call).rejects.toMatchObject({ code: 'timeout' });
      const worker = forked[0]!;
      const { id } = worker.sent[0]!;
      await vi.advanceTimersByTimeAsync(999);
      expect(worker.sent).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      await failed;
      expect(worker.sent.at(-1)).toEqual({ type: 'cancel', id });
      worker.emit('message', { type: 'result', id, value: 'abc' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('knows which folders its running jobs work in, until they finish', async () => {
    const call = callWorker('makeThumbnail', [{ sourcePath: 'D:/a.mp4', time: 1, height: 240, out: 'C:/cache/x/1.jpg' }]);
    expect(inUse('C:/cache/x')).toBe(true);
    expect(inUse('c:/CACHE/X')).toBe(true);
    expect(inUse('C:/cache/y')).toBe(false);
    const worker = forked[0]!;
    worker.emit('message', { type: 'result', id: worker.sent[0]!.id, value: undefined });
    await call;
    expect(inUse('C:/cache/x')).toBe(false);
  });

  it('starts a job in a folder being deleted only once it is gone', async () => {
    let deleted!: () => void;
    const deleting = holding('C:/cache/x', () => new Promise<void>((r) => (deleted = r)));
    const call = callWorker('makeThumbnail', [{ sourcePath: 'D:/a.mp4', time: 1, height: 240, out: 'C:/cache/x/1.jpg' }]);
    // Elsewhere, jobs go on as usual.
    const other = callWorker('fingerprint', ['C:/cache/y/a.mp4']);
    const worker = forked[0]!;
    expect(worker.sent.map((m) => m.type)).toEqual(['call']);
    deleted();
    await deleting;
    await new Promise((r) => setTimeout(r, 0));
    expect(worker.sent).toHaveLength(2);
    for (const { id } of worker.sent) worker.emit('message', { type: 'result', id, value: undefined });
    await Promise.all([call, other]);
  });

  it('stops listening to the signal once the call is over', async () => {
    const abort = new AbortController();
    const removed = vi.spyOn(abort.signal, 'removeEventListener');
    const call = callWorker('fingerprint', ['a.mp4'], { signal: abort.signal });
    const worker = forked[0]!;
    const { id } = worker.sent[0]!;
    worker.emit('message', { type: 'result', id, value: 'abc' });
    await expect(call).resolves.toBe('abc');
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
    // An abort after the call is over is nobody's business.
    abort.abort();
    expect(worker.sent).toHaveLength(1);
  });
});
