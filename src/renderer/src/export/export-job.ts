/**
 * Renders an export: every frame of the clip, drawn by the same compositor
 * code as the preview, converted to yuv420p on the GPU and sent to the
 * encoder in the media worker (path A-yuv in spikes/REPORT.md).
 *
 * Three readbacks are in progress at once, so the GPU renders the next
 * frame while an earlier one is being read, and at most four frames are on
 * their way to the encoder; the encoder acknowledges each one.
 */
import type { ExportJob } from '../../../shared/api.ts';
import { frameRecipe } from '../../../shared/framing.ts';
import type { VideoLayer } from '../../../shared/project.ts';
import type { ExportPortReply, ExportPortRequest } from '../../../shared/worker-api.ts';
import { workingFrameTime } from '../../../shared/working.ts';
import { Compositor, YUV_BYTES } from '../render/compositor.ts';
import { demux } from '../render/demux.ts';
import { FrameSource } from '../render/frame-source.ts';

const SLOTS = 3;
const IN_FLIGHT = 4;

/** The page's side of the port, through the relay worker. Replies come back in order. */
class EncoderLink {
  private readonly relay: Worker;
  private readonly free: Uint8Array[] = [];
  private readonly waiting: { resolve: () => void; reject: (e: Error) => void }[] = [];
  private failure: Error | undefined;

  constructor(port: MessagePort) {
    this.relay = new Worker(new URL('./relay.worker.ts', import.meta.url), { type: 'module' });
    this.relay.onmessage = (e: MessageEvent<ExportPortReply | { type: 'recycle'; data: Uint8Array }>) => {
      const msg = e.data;
      if (msg.type === 'recycle') this.free.push(msg.data);
      else if (msg.type === 'ack') this.waiting.shift()?.resolve();
      else this.fail(new Error(msg.message));
    };
    this.relay.onerror = (e) => this.fail(new Error(e.message || 'the export relay failed'));
    this.relay.postMessage({ type: 'port' }, [port]);
  }

  /** Set once the encoder has given up; nothing sent after that matters. */
  get error(): Error | undefined {
    return this.failure;
  }

  /** A buffer for the next frame; send() takes it over. */
  buffer(): Uint8Array {
    return this.free.pop() ?? new Uint8Array(YUV_BYTES);
  }

  /** Resolves when the encoder has taken the frame. */
  send(data: Uint8Array): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    const acked = new Promise<void>((resolve, reject) => this.waiting.push({ resolve, reject }));
    this.post({ type: 'frame', data }, [data.buffer]);
    return acked;
  }

  /** The last message; the relay closes the port after it. */
  finish(message: Extract<ExportPortRequest, { type: 'end' | 'fail' }>): void {
    this.post(message, []);
  }

  private post(message: ExportPortRequest, transfer: Transferable[]): void {
    this.relay.postMessage(message, transfer);
  }

  /** Stops waiting for the encoder: pending and later sends reject with `error`. */
  fail(error: Error): void {
    this.failure ??= error;
    for (const w of this.waiting.splice(0)) w.reject(this.failure);
  }
}

export interface RenderOptions {
  signal: AbortSignal;
  /** Frames handed to the encoder so far. */
  onProgress(done: number): void;
}

/** Renders and sends every frame of `job`. Rejects when it fails or is aborted; the encoder is told either way. */
export async function renderExport(job: ExportJob, port: MessagePort, layer: VideoLayer, { signal, onProgress }: RenderOptions): Promise<void> {
  const link = new EncoderLink(port);
  // Aborting also stops waiting for acks that may never come (the worker gone).
  const stop = () => link.fail(new Error('export stopped'));
  signal.addEventListener('abort', stop, { once: true });
  // A canvas of its own: the export doesn't disturb the preview.
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  let compositor: Compositor | undefined;
  let frames: FrameSource | undefined;
  try {
    const response = await fetch(job.url);
    if (!response.ok) throw new Error(`loading the working file failed: ${response.status}`);
    const media = await demux(await response.arrayBuffer());
    const size = { width: media.width, height: media.height };
    compositor = new Compositor(canvas);
    frames = new FrameSource(media);

    const c = compositor;
    const pending: number[] = [];
    const inFlight: Promise<void>[] = [];
    let slot = 0;
    let sent = 0;
    const sendOne = async () => {
      const data = await c.collect(pending.shift()!, link.buffer());
      if (inFlight.length === IN_FLIGHT) await inFlight.shift();
      const acked = link.send(data);
      acked.catch(() => {}); // awaited later; a failure stops the loop through link.error
      inFlight.push(acked);
      onProgress(++sent);
    };

    for await (const { frame, index } of frames.frames(job.first, job.count)) {
      if (signal.aborted || link.error) {
        frame.close();
        break;
      }
      c.upload(frame);
      frame.close();
      c.render(frameRecipe(layer, workingFrameTime(job, index), size));
      if (pending.length === SLOTS) await sendOne();
      c.startReadback(slot);
      pending.push(slot);
      slot = (slot + 1) % SLOTS;
    }
    signal.throwIfAborted();
    if (link.error) throw link.error;
    while (pending.length > 0) await sendOne();
    await Promise.all(inFlight);
    if (sent !== job.count) throw new Error(`rendered ${sent} of ${job.count} frames`);
    link.finish({ type: 'end' });
  } catch (e) {
    link.finish({ type: 'fail', message: e instanceof Error ? e.message : String(e) });
    throw e;
  } finally {
    signal.removeEventListener('abort', stop);
    frames?.close();
    compositor?.dispose();
    // Nothing else will use this canvas, so its GPU context can go now rather than at garbage collection.
    compositor?.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
