/**
 * The encoder's side of an export, with FFmpeg and ffprobe stood in for:
 * what happens around a cancel, and what a long export leaves on the process.
 */
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportRequest } from '../../shared/worker-api.ts';
import type { JobContext } from './index.ts';

/** FFmpeg: takes frames on stdin, says it's full when `full`, and exits with 0 once stdin ends. */
class FakeFfmpeg extends EventEmitter {
  full = false;
  stdin = Object.assign(new EventEmitter(), {
    write: () => !this.full,
    end: () => void setImmediate(() => this.emit('close', 0)),
  });
  stderr = Object.assign(new EventEmitter(), { setEncoding: () => this.stderr });
  kill = vi.fn(() => void setImmediate(() => this.emit('close', null)));
}

const made: FakeFfmpeg[] = [];
const rename = vi.fn(async () => {});
const rm = vi.fn(async () => {});
/** ffprobe counting the frames; each test says how it answers. */
const exec = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: () => {
    const child = new FakeFfmpeg();
    made.push(child);
    return child;
  },
}));
vi.mock('node:fs/promises', () => ({ rename, rm }));
vi.mock('./exec.ts', () => ({ exec, ffmpegExe: () => 'ffmpeg', ffprobeExe: () => 'ffprobe' }));

const { encodeExport } = await import('./export.ts');

const request = (frames: number): ExportRequest => ({
  out: 'D:\\Klipovi\\klip.mp4',
  workingFile: 'D:\\cache\\work.mp4',
  audioPieces: [{ start: 0, duration: 1 }],
  duration: 1,
  hasAudio: false,
  gain: 1,
  sounds: [],
  frameRate: [30, 1],
  frames,
  encoder: 'x264',
});

/** The page's end of the frame channel. */
class FakePort extends EventEmitter {
  replies: { type: string }[] = [];
  start() {}
  close() {}
  postMessage(message: { type: string }) {
    this.replies.push(message);
    this.emit('reply');
  }
  send(data: unknown) {
    this.emit('message', { data });
  }
}

function start(frames: number) {
  const abort = new AbortController();
  const port = new FakePort();
  const ctx = { signal: abort.signal, progress() {}, ports: [port] } as unknown as JobContext;
  const done = encodeExport(ctx, request(frames));
  done.catch(() => {});
  return { abort, port, done, ffmpeg: made.at(-1)! };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  made.length = 0;
  rename.mockClear();
  rm.mockClear();
  exec.mockReset();
});

describe('encodeExport', () => {
  it('puts the finished file in place', async () => {
    exec.mockResolvedValue({ stdout: '1\n', stderr: '' });
    const { port, done } = start(1);
    port.send({ type: 'frame', data: new Uint8Array(4) });
    port.send({ type: 'end' });
    await done;
    expect(rename).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/klip\.mp4\..+\.part$/), 'D:\\Klipovi\\klip.mp4');
  });

  it('leaves the chosen file alone when cancelled while the frames are being counted', async () => {
    // ffprobe runs until it's stopped, as a real one would be by the signal.
    exec.mockImplementation(
      (_cmd: string, _args: string[], options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason))),
    );
    const { abort, port, done } = start(1);
    port.send({ type: 'frame', data: new Uint8Array(4) });
    port.send({ type: 'end' });
    await vi.waitFor(() => expect(exec).toHaveBeenCalled());
    abort.abort();
    await expect(done).rejects.toThrow();
    expect(rename).not.toHaveBeenCalled();
    expect(rm).toHaveBeenCalledOnce();
  });

  it('leaves the chosen file alone when cancelled just as the count comes back', async () => {
    const { abort, port, done } = start(1);
    exec.mockImplementation(async () => {
      abort.abort();
      return { stdout: '1\n', stderr: '' };
    });
    port.send({ type: 'frame', data: new Uint8Array(4) });
    port.send({ type: 'end' });
    await expect(done).rejects.toThrow();
    expect(rename).not.toHaveBeenCalled();
  });

  it('leaves no listeners on FFmpeg for the frames that had to wait', async () => {
    exec.mockResolvedValue({ stdout: '200\n', stderr: '' });
    const { port, done, ffmpeg } = start(200);
    ffmpeg.full = true;
    const before = { close: ffmpeg.listenerCount('close'), error: ffmpeg.listenerCount('error'), drain: ffmpeg.stdin.listenerCount('drain') };
    for (let i = 0; i < 200; i++) {
      port.send({ type: 'frame', data: new Uint8Array(4) });
      await tick();
      // Waiting for room: nothing is acknowledged until FFmpeg drains.
      expect(port.replies).toHaveLength(i);
      ffmpeg.stdin.emit('drain');
      await tick();
      expect(port.replies).toHaveLength(i + 1);
    }
    expect({ close: ffmpeg.listenerCount('close'), error: ffmpeg.listenerCount('error'), drain: ffmpeg.stdin.listenerCount('drain') }).toEqual(before);
    port.send({ type: 'end' });
    await done;
  });
});
