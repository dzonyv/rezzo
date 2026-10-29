/**
 * IPC lab, sandboxed renderer. Two measurements:
 *
 *   transfer  3.1 MB YUV frames sent to the utility process and dropped there
 *   export    the Phase 0 A-yuv path (render, YUV shader, PBO readback) with
 *             FFmpeg in the utility process instead of in the renderer, on
 *             the synthetic source and on a real 1080p clip
 *
 * --link picks how frames reach the utility process:
 *
 *   direct  the page posts them on the Electron MessagePort itself
 *   relay   the page hands them (zero-copy) to a dedicated Web Worker that
 *           owns the port, so the copy into the other process happens off
 *           the thread that renders
 *
 * Listing an ArrayBuffer as transferable on the Electron port doesn't work:
 * the message arrives in the utility process as null (Electron 45), so the
 * cross-process hop is always a copy.
 *
 * Results go to <media>/ipc/results.json through the main process.
 */
import { FRAME_COUNT, FPS, OUT_H, OUT_W, START_FRAME } from '../export/layout.ts';
import { demux, FrameSource, type Demuxed } from '../export/lab/decode.ts';
import { Compositor, YUV_BYTES } from '../export/lab/gl.ts';

interface Lab {
  args(): Promise<{ args: string[]; mediaDir: string }>;
  result(key: string, value: unknown): Promise<void>;
  done(code: number): void;
}
const lab = (window as unknown as { lab: Lab }).lab;

/** Frames allowed to be on their way to (or inside) the utility process. */
const IN_FLIGHT = 4;
const COLOR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

const logEl = document.getElementById('log')!;
function log(message: string): void {
  console.log(message);
  logEl.textContent += `${message}\n`;
}

const round = (x: number, digits = 1) => +x.toFixed(digits);

/** Request/reply with the utility process. Replies come back in request order. */
abstract class Link {
  private waiting: { resolve: (v: unknown) => void; reject: (e: Error) => void }[] = [];

  protected reply(data: { type?: string; message?: string }): void {
    const w = this.waiting.shift();
    if (data?.type === 'error') w?.reject(new Error(data.message));
    else w?.resolve(data);
  }

  call(message: object, transfer: Transferable[] = []): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject });
      this.post(message, transfer);
    });
  }

  /** A buffer to fill with the next frame. sendFrame() takes it back. */
  abstract frameBuffer(): Uint8Array;
  abstract sendFrame(data: Uint8Array): Promise<unknown>;
  protected abstract post(message: object, transfer: Transferable[]): void;
}

class DirectLink extends Link {
  private port: MessagePort;
  // postMessage copies synchronously, so one buffer serves every frame.
  private buffer = new Uint8Array(YUV_BYTES);

  constructor(port: MessagePort) {
    super();
    this.port = port;
    port.onmessage = (e) => this.reply(e.data);
  }

  frameBuffer(): Uint8Array {
    return this.buffer;
  }

  sendFrame(data: Uint8Array): Promise<unknown> {
    return this.call({ type: 'frame', data });
  }

  protected post(message: object): void {
    this.port.postMessage(message);
  }
}

class RelayLink extends Link {
  private relay: Worker;
  private free: Uint8Array[] = [];

  constructor(port: MessagePort) {
    super();
    this.relay = new Worker('relay.js');
    this.relay.postMessage({ type: 'port' }, [port]);
    this.relay.onmessage = (e) => {
      if (e.data.type === 'recycle') this.free.push(e.data.data);
      else this.reply(e.data.reply);
    };
  }

  frameBuffer(): Uint8Array {
    return this.free.pop() ?? new Uint8Array(YUV_BYTES);
  }

  sendFrame(data: Uint8Array): Promise<unknown> {
    return this.call({ type: 'frame', data }, [data.buffer]);
  }

  protected post(message: object, transfer: Transferable[]): void {
    this.relay.postMessage({ type: 'call', message }, transfer);
  }
}

async function transfer(link: Link) {
  const N = 600;
  await link.call({ type: 'open', sink: 'discard' });
  const inFlight: Promise<unknown>[] = [];
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    if (inFlight.length === IN_FLIGHT) await inFlight.shift();
    const data = link.frameBuffer();
    data[0] = i & 255;
    inFlight.push(link.sendFrame(data));
  }
  await Promise.all(inFlight);
  await link.call({ type: 'close' });
  const s = (performance.now() - t0) / 1000;
  const result = { frames: N, fps: round(N / s), mbPerSecond: round((N * YUV_BYTES) / 1e6 / s), msPerFrame: round((s * 1000) / N, 2) };
  log(`transfer: ${JSON.stringify(result)}`);
  return result;
}

function encoderArgs(encoder: 'nvenc' | 'x264'): string[] {
  return encoder === 'nvenc'
    ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '19',
       '-b:v', '16M', '-maxrate', '24M', '-bufsize', '32M', '-profile:v', 'high']
    : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high'];
}

async function exportRun(c: Compositor, link: Link, media: Demuxed, input: { file: string; start: number; count: number }, encoder: 'nvenc' | 'x264', out: string) {
  await link.call({
    type: 'open',
    sink: 'ffmpeg',
    args: [
      '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${OUT_W}x${OUT_H}`, '-r', String(FPS), ...COLOR_TAGS, '-i', 'pipe:0',
      '-ss', String(input.start / FPS), '-t', String(input.count / FPS), '-i', input.file,
      '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
      ...encoderArgs(encoder), '-g', '60', ...COLOR_TAGS, out,
    ],
  });

  const SLOTS = 3;
  const pending: number[] = [];
  const inFlight: Promise<unknown>[] = [];
  let slot = 0;
  const wait = { collectMs: 0, ackMs: 0, sendMs: 0 };

  const sendOne = async () => {
    let t = performance.now();
    const data = await c.collect(pending.shift()!, link.frameBuffer());
    wait.collectMs += performance.now() - t;
    t = performance.now();
    if (inFlight.length === IN_FLIGHT) await inFlight.shift();
    wait.ackMs += performance.now() - t;
    t = performance.now();
    inFlight.push(link.sendFrame(data));
    wait.sendMs += performance.now() - t;
  };

  const src = new FrameSource(media);
  const t0 = performance.now();
  let frames = 0;
  for await (const { frame, index } of src.frames(input.start, input.count)) {
    c.render(frame, index - input.start);
    frame.close();
    if (pending.length === SLOTS) await sendOne();
    c.startReadback('yuv', slot);
    pending.push(slot);
    slot = (slot + 1) % SLOTS;
    if (frames % 30 === 0) c.present();
    frames++;
  }
  while (pending.length > 0) await sendOne();
  await Promise.all(inFlight);
  await link.call({ type: 'close' });
  src.close();

  const s = (performance.now() - t0) / 1000;
  const sec = (ms: number) => round(ms / 1000, 2);
  return {
    frames,
    seconds: round(s, 2),
    fps: round(frames / s),
    waitSeconds: { collect: sec(wait.collectMs), ack: sec(wait.ackMs), send: sec(wait.sendMs) },
  };
}

async function exports(c: Compositor, link: Link, mediaDir: string, only: string[] | undefined) {
  const inputs = {
    synthetic: { file: `${mediaDir}\\export\\work-g30.mp4`, start: START_FRAME, count: FRAME_COUNT },
    real: { file: `${mediaDir}\\ipc\\work\\clip-a-x264.mp4`, start: 0, count: Infinity },
  };
  const results: Record<string, unknown> = {};
  for (const [name, input] of Object.entries(inputs)) {
    const bytes = new Uint8Array(await (await fetch(`media://file/?path=${encodeURIComponent(input.file)}`)).arrayBuffer());
    const media = await demux(bytes, input.file);
    const count = Math.min(input.count, media.samples.length - input.start);
    for (const encoder of ['nvenc', 'x264'] as const) {
      const key = `${name}-${encoder}`;
      if (only && !only.includes(key)) continue;
      log(`export ${key}...`);
      const out = `${mediaDir}\\ipc\\${key}.mp4`;
      results[key] = await exportRun(c, link, media, { ...input, count }, encoder, out);
      log(`export ${key}: ${JSON.stringify(results[key])}`);
    }
  }
  return results;
}

async function main() {
  const { args, mediaDir } = await lab.args();
  const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const runs = (arg('run') ?? 'transfer,export').split(',');
  const only = arg('only')?.split(',');
  const kind = arg('link') ?? 'relay';

  const port = await new Promise<MessagePort>((resolve) => {
    window.addEventListener('message', (e) => {
      if (e.data === 'lab:port') resolve(e.ports[0]);
    });
  });
  const link = kind === 'direct' ? new DirectLink(port) : new RelayLink(port);
  log(`link: ${kind}`);

  if (runs.includes('transfer')) await lab.result(`transfer-${kind}`, await transfer(link));
  if (runs.includes('export')) {
    const c = new Compositor(document.getElementById('view') as HTMLCanvasElement);
    await lab.result(`exports-${kind}`, await exports(c, link, mediaDir, only));
  }
}

main().then(
  () => lab.done(0),
  (e) => {
    console.error(e?.stack ?? String(e));
    lab.done(1);
  },
);
