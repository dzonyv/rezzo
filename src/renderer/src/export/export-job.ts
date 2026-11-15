/**
 * Renders an export: every frame of the clip, drawn by the same scene
 * renderer as the preview, converted to yuv420p on the GPU and sent to the
 * encoder in the media worker (path A-yuv in spikes/REPORT.md).
 *
 * Three readbacks are in progress at once, so the GPU renders the next
 * frame while an earlier one is being read, and at most four frames are on
 * their way to the encoder; the encoder acknowledges each one.
 */
import type { ExportJob } from '../../../shared/api.ts';
import type { Asset } from '../../../shared/assets.ts';
import type { Clip, Word } from '../../../shared/project.ts';
import type { ExportPortReply, ExportPortRequest } from '../../../shared/worker-api.ts';
import { coverClip, coverLeadFrames, coverOf } from '../../../shared/cover.ts';
import { fps } from '../../../shared/frames.ts';
import { workingFrameIndex, workingFrameTime } from '../../../shared/working.ts';
import { Compositor, YUV_BYTES } from '../render/compositor.ts';
import { demux } from '../render/demux.ts';
import { FrameSource } from '../render/frame-source.ts';
import { loadScene, SceneRenderer, type Scene } from '../render/scene-renderer.ts';

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

/**
 * The clip's cover as one exported frame (yuv420p), drawn by `renderer`
 * from the working file's frame at the cover's moment, as drawCover does
 * for the saved picture.
 */
async function drawCoverFrame(clip: Clip, assets: readonly Asset[], job: ExportJob, frames: FrameSource, renderer: SceneRenderer, signal: AbortSignal): Promise<Uint8Array> {
  const time = coverOf(clip).time;
  // The clip's layers stay loaded for the frames after it.
  const scene: Scene = { ...(await loadScene(coverClip(clip), assets, [], job.frameRate, signal)), keep: clip.layers.map((l) => l.id) };
  const frame = await frames.seek(Math.min(Math.max(0, workingFrameIndex(job, time)), frames.frameCount - 1));
  try {
    renderer.compositor.upload(frame);
  } finally {
    frame.close();
  }
  await renderer.prepare(scene, time, false);
  renderer.draw(scene, time);
  renderer.compositor.startReadback(0);
  return renderer.compositor.collect(0, new Uint8Array(YUV_BYTES));
}

export interface RenderOptions {
  signal: AbortSignal;
  /** Frames handed to the encoder so far. */
  onProgress(done: number): void;
}

/**
 * Renders and sends every frame of `job`: `clip` with captions from the
 * transcript's `words` and its layers' files from `assets`. Rejects when it
 * fails or is aborted; the encoder is told either way.
 */
export async function renderExport(job: ExportJob, port: MessagePort, clip: Clip, words: readonly Word[], assets: readonly Asset[], { signal, onProgress }: RenderOptions): Promise<void> {
  const link = new EncoderLink(port);
  // Aborting also stops waiting for acks that may never come (the worker gone).
  const stop = () => link.fail(new Error('export stopped'));
  signal.addEventListener('abort', stop, { once: true });
  // A canvas of its own: the export doesn't disturb the preview.
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  let compositor: Compositor | undefined;
  let renderer: SceneRenderer | undefined;
  let frames: FrameSource | undefined;
  try {
    const response = await fetch(job.url, { signal });
    if (!response.ok) throw new Error(`loading the working file failed: ${response.status}`);
    const media = await demux(await response.arrayBuffer());
    // Fonts and pictures are loaded before the first frame, so none is drawn without them.
    const scene = await loadScene(clip, assets, words, job.frameRate, signal);
    compositor = new Compositor(canvas);
    renderer = new SceneRenderer(compositor);
    const r = renderer;
    let layerError: unknown;
    r.layers.onError = (_layerId, e) => (layerError ??= e);
    r.lotties.onError = (_layerId, e) => (layerError ??= e);
    frames = new FrameSource(media);

    const c = compositor;
    const pending: number[] = [];
    const inFlight: Promise<void>[] = [];
    let slot = 0;
    let sent = 0;
    const send = async (data: Uint8Array) => {
      if (inFlight.length === IN_FLIGHT) await inFlight.shift();
      const acked = link.send(data);
      acked.catch(() => {}); // awaited later; a failure stops the loop through link.error
      inFlight.push(acked);
      onProgress(++sent);
    };
    const sendOne = async () => send(await c.collect(pending.shift()!, link.buffer()));

    // The cover first, in place of the clip's first frames: drawn once and sent again for each.
    let lead = 0;
    if (clip.cover?.inVideo) {
      const still = await drawCoverFrame(clip, assets, job, frames, r, signal);
      if (layerError) throw layerError;
      lead = Math.min(job.count, coverLeadFrames(fps(job.frameRate)));
      for (let i = 0; i < lead && !signal.aborted && !link.error; i++) {
        const data = link.buffer();
        data.set(still);
        await send(data);
      }
    }

    /** Draws and reads back working-file frame `index` over the picture last uploaded. */
    const render = async (index: number) => {
      const time = workingFrameTime(job, index);
      await r.prepare(scene, time, true);
      // A video layer that can't be decoded, or an animation that can't be loaded, fails the export rather than going missing from it.
      if (layerError) throw layerError;
      r.draw(scene, time);
      if (pending.length === SLOTS) await sendOne();
      c.startReadback(slot);
      pending.push(slot);
      slot = (slot + 1) % SLOTS;
    };

    const fileFrames = frames.frameCount;
    for (const piece of job.pieces) {
      if (signal.aborted || link.error) break;
      const end = piece.first + piece.count;
      let next = piece.first;
      for await (const { frame, index } of frames.frames(piece.first, piece.count)) {
        if (signal.aborted || link.error) {
          frame.close();
          break;
        }
        next = index + 1;
        if (lead > 0) {
          // Under the cover.
          lead--;
          frame.close();
          continue;
        }
        c.upload(frame);
        frame.close();
        await render(index);
      }
      // A source's picture can end a frame or two before its sound, and the
      // working file with it. The last picture stays up for the rest, as in
      // a player; captions and layers go on over it.
      if (next >= fileFrames && next < end && fileFrames > 0 && !signal.aborted && !link.error) {
        if (next === piece.first) {
          const last = await frames.seek(fileFrames - 1);
          try {
            c.upload(last);
          } finally {
            last.close();
          }
        }
        for (; next < end && !signal.aborted && !link.error; next++) {
          if (lead > 0) lead--;
          else await render(next);
        }
      }
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
    renderer?.dispose();
    compositor?.dispose();
    // Nothing else will use this canvas, so its GPU context can go now rather than at garbage collection.
    compositor?.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
