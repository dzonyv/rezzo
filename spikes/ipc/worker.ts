/**
 * Utility process: receives frames from the renderer over a MessagePort and
 * either drops them (to time the transfer alone) or pipes them into FFmpeg.
 * Every frame is acknowledged once it has been handled, which is how the
 * renderer keeps a bounded number of frames in flight.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import type { MessagePortMain } from 'electron';
import { ffmpegExe } from '../shared/tools.ts';

type Request =
  | { type: 'open'; sink: 'discard' }
  | { type: 'open'; sink: 'ffmpeg'; args: string[] }
  | { type: 'frame'; data: Uint8Array }
  | { type: 'close' };

let ffmpeg: { child: ChildProcess; done: Promise<void> } | undefined;
let queue = Promise.resolve();

process.parentPort.once('message', (e) => {
  const port: MessagePortMain = e.ports[0];
  port.on('message', ({ data }) => {
    // Handle messages strictly in order; writes to FFmpeg are asynchronous.
    queue = queue.then(() => handle(data as Request)).then(
      (reply) => port.postMessage(reply),
      (err) => port.postMessage({ type: 'error', message: String(err?.stack ?? err) }),
    );
  });
  port.start();
});

async function handle(req: Request): Promise<unknown> {
  switch (req.type) {
    case 'open':
      if (req.sink === 'ffmpeg') ffmpeg = start(req.args);
      return { type: 'opened' };
    case 'frame':
      if (ffmpeg) {
        const stdin = ffmpeg.child.stdin!;
        const buf = Buffer.from(req.data.buffer, req.data.byteOffset, req.data.byteLength);
        if (!stdin.write(buf)) await once(stdin, 'drain');
      }
      return { type: 'ack' };
    case 'close':
      if (ffmpeg) {
        ffmpeg.child.stdin!.end();
        await ffmpeg.done;
        ffmpeg = undefined;
      }
      return { type: 'closed' };
  }
}

function start(args: string[]) {
  const child = spawn(ffmpegExe(), ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr!.on('data', (d) => (stderr += d));
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}: ${stderr}`))));
  });
  return { child, done };
}
