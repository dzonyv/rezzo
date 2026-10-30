/**
 * The export's FFmpeg end (decisions in spikes/REPORT.md): the renderer
 * draws each frame, converts it to yuv420p on the GPU and sends it over a
 * MessagePort; here it's piped into FFmpeg, which encodes it with NVENC or
 * x264 and adds the clip's sound from the working file.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { rename, rm } from 'node:fs/promises';
import type { MessagePortMain } from 'electron';
import { OUTPUT } from '../../shared/framing.ts';
import { fps } from '../../shared/frames.ts';
import type { Encoder, ExportPortReply, ExportPortRequest, ExportRequest } from '../../shared/worker-api.ts';
import { exec, ffmpegExe, ffprobeExe } from './exec.ts';
import type { JobContext } from './index.ts';
import { COLOR_TAGS } from './working.ts';

const ENCODER_ARGS: Record<Encoder, string[]> = {
  nvenc: [
    '-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '19',
    '-b:v', '16M', '-maxrate', '24M', '-bufsize', '32M', '-profile:v', 'high',
  ],
  x264: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high'],
};

/** FFmpeg arguments for an export written to `out`. Frames come on stdin. */
export function exportArgs(req: ExportRequest, out: string): string[] {
  const [num, den] = req.frameRate;
  return [
    '-y', '-v', 'error', '-nostats',
    '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${OUTPUT.width}x${OUTPUT.height}`, '-framerate', `${num}/${den}`,
    ...COLOR_TAGS, '-i', 'pipe:0',
    '-ss', req.audioStart.toFixed(6), '-t', req.duration.toFixed(6), '-i', req.workingFile,
    // A working file without sound gives a silent clip.
    '-map', '0:v', '-map', '1:a:0?',
    ...ENCODER_ARGS[req.encoder],
    // A keyframe every two seconds.
    '-g', String(Math.round(2 * fps(req.frameRate))),
    ...COLOR_TAGS,
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart', '-f', 'mp4', out,
  ];
}

let picked: Promise<Encoder> | undefined;

/**
 * NVENC when a one-frame test encode works (an NVIDIA card with a recent
 * enough driver), x264 otherwise. REZZO_ENCODER forces one, for tests.
 */
export function pickEncoder(): Promise<Encoder> {
  const forced = process.env['REZZO_ENCODER'];
  if (forced === 'nvenc' || forced === 'x264') return Promise.resolve(forced);
  picked ??= exec(ffmpegExe(), [
    '-v', 'error', '-f', 'lavfi', '-i', `color=c=black:s=${OUTPUT.width}x${OUTPUT.height}:r=30`,
    '-frames:v', '1', '-c:v', 'h264_nvenc', '-f', 'null', '-',
  ]).then(
    () => 'nvenc' as const,
    () => 'x264' as const,
  );
  return picked;
}

class ExportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Video frames in a finished file, counted from its packets. */
async function countFrames(file: string): Promise<number> {
  const { stdout } = await exec(ffprobeExe(), [
    '-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file,
  ]);
  return Number(stdout.trim());
}

export async function encodeExport(ctx: JobContext, req: ExportRequest): Promise<void> {
  const port = ctx.ports[0];
  if (!port) throw new Error('encodeExport needs a MessagePort');
  // Next to the chosen file, so the final rename stays on one drive.
  const part = `${req.out}.${randomUUID().slice(0, 8)}.part`;
  try {
    await encode(ctx, req, port, part);
    const frames = await countFrames(part);
    if (frames !== req.frames) throw new ExportError('frame-count', `expected ${req.frames} frames, the file has ${frames}`);
    await rename(part, req.out);
  } catch (e) {
    await rm(part, { force: true });
    throw e;
  } finally {
    port.close();
  }
}

function encode(ctx: JobContext, req: ExportRequest, port: MessagePortMain, part: string): Promise<void> {
  const child = spawn(ffmpegExe(), exportArgs(req, part), { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
  // Writes after FFmpeg has gone fail with EPIPE; its exit code says why.
  child.stdin.on('error', () => {});
  const reply = (message: ExportPortReply) => port.postMessage(message);
  // Windows won't delete the part file while FFmpeg still has it open.
  const exited = new Promise<void>((resolve) => {
    child.on('close', () => resolve());
    child.on('error', () => resolve());
  });

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      ctx.signal.removeEventListener('abort', abort);
      if (error) {
        child.kill();
        reply({ type: 'error', message: error.message });
        void exited.then(() => reject(error));
      } else {
        resolve();
      }
    };
    const abort = () => finish(new ExportError('cancelled', 'export cancelled'));
    ctx.signal.addEventListener('abort', abort);

    let received = 0;
    let ended = false;
    child.on('error', (e) => finish(e));
    child.on('close', (code) => {
      if (code === 0 && ended) finish();
      else finish(new ExportError('ffmpeg-failed', `ffmpeg exited with ${code}: ${stderr.trim().split('\n').slice(-5).join('\n')}`));
    });

    // Handled strictly in order: a frame waits until FFmpeg has room for it.
    let queue = Promise.resolve();
    const handle = async (msg: ExportPortRequest) => {
      if (settled) return;
      if (msg.type === 'frame') {
        received++;
        const buf = Buffer.from(msg.data.buffer, msg.data.byteOffset, msg.data.byteLength);
        if (!child.stdin.write(buf)) await Promise.race([once(child.stdin, 'drain'), once(child, 'close')]);
        reply({ type: 'ack' });
      } else if (msg.type === 'end') {
        if (received !== req.frames) {
          finish(new ExportError('frame-count', `expected ${req.frames} frames, received ${received}`));
          return;
        }
        ended = true;
        child.stdin.end();
      } else {
        finish(new Error(msg.message));
      }
    };
    const fail = (e: unknown) => finish(e instanceof Error ? e : new Error(String(e)));
    port.on('message', ({ data }) => {
      queue = queue.then(() => handle(data as ExportPortRequest)).catch(fail);
    });
    // The page closes the port after its last message; before "end" it means the page went away.
    port.on('close', () => {
      queue = queue.then(() => {
        if (!ended) finish(new Error('the page stopped sending frames'));
      });
    });
    port.start();
  });
}
