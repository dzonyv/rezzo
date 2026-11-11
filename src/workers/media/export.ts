/**
 * The export's FFmpeg end (decisions in spikes/REPORT.md): the renderer
 * draws each frame, converts it to yuv420p on the GPU and sends it over a
 * MessagePort; here it's piped into FFmpeg, which encodes it with NVENC or
 * x264 and adds the clip's sound from the working file, with the video
 * layers' sound mixed in.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rename, rm } from 'node:fs/promises';
import type { MessagePortMain } from 'electron';
import { OUTPUT } from '../../shared/framing.ts';
import { fps } from '../../shared/frames.ts';
import { LIMITER } from '../../shared/loudness.ts';
import { JOIN_FADE_SECONDS } from '../../shared/skips.ts';
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

export const STEREO_48K = 'aformat=sample_rates=48000:channel_layouts=stereo';

/**
 * The clip's own sound when it has skips: each piece of the working file,
 * counted from where the input starts, faded at the joins and put end to end
 * (the graph up to the concat, without its output label).
 */
function joinedSound(pieces: ExportRequest['audioPieces']): string {
  const first = pieces[0]!.start;
  const parts = pieces.map((p, i) => {
    const from = p.start - first;
    const fades = [
      ...(i > 0 ? [`afade=t=in:d=${JOIN_FADE_SECONDS}`] : []),
      ...(i < pieces.length - 1 ? [`afade=t=out:st=${(p.duration - JOIN_FADE_SECONDS).toFixed(6)}:d=${JOIN_FADE_SECONDS}`] : []),
    ];
    return `${[`[1:a:0]atrim=start=${from.toFixed(6)}:end=${(from + p.duration).toFixed(6)}`, 'asetpts=PTS-STARTPTS', STEREO_48K, ...fades].join(',')}[p${i}]`;
  });
  return `${parts.join(';')};${pieces.map((_, i) => `[p${i}]`).join('')}concat=n=${pieces.length}:v=0:a=1`;
}

/**
 * The clip's sound, turned up or down by its gain, with the layers' sound
 * over it: each layer's file is an input of its own (looped when the layer
 * loops), cut to what plays, set to its volume (its own evening-out gain
 * included), faded and delayed to where it plays. Then everything is added
 * up as it is, cut to the clip's length and held under the ceiling by the
 * limiter (shared/loudness.ts), which only touches the rare peaks.
 */
function soundMix(req: ExportRequest): { inputs: string[]; graph: string } {
  const inputs: string[] = [];
  const parts: string[] = [];
  const mix: string[] = [];
  if (req.hasAudio) {
    const gain = req.gain === 1 ? '' : `,volume=${req.gain.toFixed(4)}`;
    parts.push(`${req.audioPieces.length > 1 ? joinedSound(req.audioPieces) : `[1:a:0]${STEREO_48K}`}${gain}[a0]`);
    mix.push('[a0]');
  }
  req.sounds.forEach((s, i) => {
    // A looped sound repeats exactly its period, as the picture counts it, and is then cut to what plays.
    if (s.loop) inputs.push('-i', s.file);
    else inputs.push('-ss', s.start.toFixed(6), '-t', s.duration.toFixed(6), '-i', s.file);
    const filters = s.loop
      ? [
          `atrim=end=${s.period.toFixed(6)}`,
          STEREO_48K,
          `aloop=loop=-1:size=${Math.round(s.period * 48_000)}`,
          `atrim=start=${s.start.toFixed(6)}:duration=${s.duration.toFixed(6)}`,
          'asetpts=PTS-STARTPTS',
        ]
      : [STEREO_48K];
    filters.push(
      `volume=${s.volume.toFixed(4)}`,
      ...(s.fadeIn > 0 ? [`afade=t=in:d=${s.fadeIn.toFixed(6)}`] : []),
      ...(s.fadeOut > 0 ? [`afade=t=out:st=${(s.duration - s.fadeOut).toFixed(6)}:d=${s.fadeOut.toFixed(6)}`] : []),
      `adelay=${Math.round(s.at * 1000)}:all=1`,
    );
    parts.push(`[${i + 2}:a:0]${filters.join(',')}[s${i}]`);
    mix.push(`[s${i}]`);
  });
  const limiter = `alimiter=limit=${LIMITER.ceiling.toFixed(4)}:attack=${LIMITER.attack * 1000}:release=${LIMITER.release * 1000}:level=false:latency=true`;
  const sum = mix.length > 1 ? `${mix.join('')}amix=inputs=${mix.length}:normalize=0:duration=longest,` : `${mix[0]}anull,`;
  parts.push(`${sum}apad,atrim=end=${req.duration.toFixed(6)},${limiter}[a]`);
  return { inputs, graph: parts.join(';') };
}

/** FFmpeg arguments for an export written to `out`. Frames come on stdin. */
export function exportArgs(req: ExportRequest, out: string): string[] {
  const [num, den] = req.frameRate;
  const mix = req.sounds.length > 0 || req.hasAudio ? soundMix(req) : null;
  const first = req.audioPieces[0]!;
  const last = req.audioPieces.at(-1)!;
  return [
    '-y', '-v', 'error', '-nostats',
    '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${OUTPUT.width}x${OUTPUT.height}`, '-framerate', `${num}/${den}`,
    ...COLOR_TAGS, '-i', 'pipe:0',
    '-ss', first.start.toFixed(6), '-t', (last.start + last.duration - first.start).toFixed(6), '-i', req.workingFile,
    ...(mix
      ? [...mix.inputs, '-filter_complex', mix.graph, '-map', '0:v', '-map', '[a]']
      : // Nothing to hear: a silent clip.
        ['-map', '0:v']),
    ...ENCODER_ARGS[req.encoder],
    // A keyframe every two seconds.
    '-g', String(Math.round(2 * fps(req.frameRate))),
    ...COLOR_TAGS,
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart', '-f', 'mp4', out,
  ];
}

let nvencWorks = false;

/**
 * NVENC when a one-frame test encode works (an NVIDIA card with a recent
 * enough driver), x264 otherwise. REZZO_ENCODER forces one, for tests.
 * Only success is remembered: NVENC can fail for a while (another program
 * holding all of the card's encoder sessions) and work again later.
 */
export async function pickEncoder(): Promise<Encoder> {
  const forced = process.env['REZZO_ENCODER'];
  if (forced === 'nvenc' || forced === 'x264') return forced;
  if (!nvencWorks) {
    nvencWorks = await exec(ffmpegExe(), [
      '-v', 'error', '-f', 'lavfi', '-i', `color=c=black:s=${OUTPUT.width}x${OUTPUT.height}:r=30`,
      '-frames:v', '1', '-c:v', 'h264_nvenc', '-f', 'null', '-',
    ]).then(
      () => true,
      () => false,
    );
  }
  return nvencWorks ? 'nvenc' : 'x264';
}

class ExportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Video frames in a finished file, counted from its packets. */
async function countFrames(file: string, signal: AbortSignal): Promise<number> {
  const { stdout } = await exec(
    ffprobeExe(),
    ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file],
    { signal },
  );
  return Number(stdout.trim());
}

export async function encodeExport(ctx: JobContext, req: ExportRequest): Promise<void> {
  const port = ctx.ports[0];
  if (!port) throw new Error('encodeExport needs a MessagePort');
  // Next to the chosen file, so the final rename stays on one drive.
  const part = `${req.out}.${randomUUID().slice(0, 8)}.part`;
  try {
    await encode(ctx, req, port, part);
    const frames = await countFrames(part, ctx.signal);
    if (frames !== req.frames) throw new ExportError('frame-count', `expected ${req.frames} frames, the file has ${frames}`);
    // Cancelled this late, the file chosen in the save dialog still stays as it was.
    ctx.signal.throwIfAborted();
    await rename(part, req.out);
  } catch (e) {
    // Whatever went wrong is what the caller hears, not a part file that wouldn't go.
    await rm(part, { force: true, maxRetries: 5, retryDelay: 40 }).catch(() => {});
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
  const reply = (message: ExportPortReply) => {
    try {
      port.postMessage(message);
    } catch {
      // The page has closed its end; the result still goes back through the call.
    }
  };
  // Windows won't delete the part file while FFmpeg still has it open.
  let gone = false;
  const exited = new Promise<void>((resolve) => {
    const done = () => {
      gone = true;
      resolve();
    };
    child.on('close', done);
    child.on('error', done);
  });
  /** Resolves when FFmpeg has room for more input, or has gone. Leaves no listener behind: this runs for every frame that had to wait. */
  const room = () =>
    new Promise<void>((resolve) => {
      if (gone) return resolve();
      const done = () => {
        child.stdin.off('drain', done);
        child.off('close', done);
        resolve();
      };
      child.stdin.on('drain', done);
      child.on('close', done);
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
        if (!child.stdin.write(buf)) await room();
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
