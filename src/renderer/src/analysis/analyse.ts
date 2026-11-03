/**
 * Analyses a clip's working file: camera cuts from a tiny grey thumbnail of
 * every frame, and the people in each shot from MediaPipe at ANALYSIS_FPS
 * (people.worker.ts). Decodes with its own FrameSource, so playback in the
 * editor isn't disturbed.
 */
import wasmBinary from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import wasmLoader from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import { ANALYSIS_FPS, ANALYSIS_VERSION, CUT_DIFF, seatsOf, shotsOf, thumbDiff, THUMB_H, THUMB_W, type AnalysedFrame, type ClipAnalysis } from '../../../shared/analysis.ts';
import { fps } from '../../../shared/frames.ts';
import type { Box } from '../../../shared/heads.ts';
import type { WorkingFile } from '../render/clip-player.ts';
import { demux } from '../render/demux.ts';
import { FrameSource } from '../render/frame-source.ts';
import type { PeopleReply, PeopleRequest } from './people-messages.ts';

/** Frames handed to the worker and not answered yet; keeps the decoder ahead without piling up bitmaps. */
const IN_FLIGHT = 3;
/** Frames go to pose no wider than this; heads in a 4K source are big enough at half size. */
const MAX_WIDTH = 1920;

type Heads = { box: Box; mouth: number | null }[];

/**
 * Frames sent to the worker, by request id. Ids are unique for the session,
 * so a cancelled analysis still waiting for its last frames and the next
 * one never get each other's answers.
 */
const pending = new Map<number, { resolve(heads: Heads): void; reject(error: Error): void }>();
let nextId = 0;

let worker: Promise<Worker> | undefined;

/** Everything waiting fails, and the next analysis starts a fresh worker. */
function workerFailed(w: Worker, error: Error): void {
  w.terminate();
  worker = undefined;
  for (const p of pending.values()) p.reject(error);
  pending.clear();
}

/** One worker for the session; the models load once. */
function peopleWorker(): Promise<Worker> {
  worker ??= (async () => {
    const urls = await window.rezzo.invoke('analysis:models');
    const [pose, face] = await Promise.all([urls.pose, urls.face].map(async (u) => (await fetch(u)).arrayBuffer()));
    // A classic worker: MediaPipe loads its WASM glue with importScripts once per task;
    // as a module it can only import it once, and the second task fails.
    const w = new Worker(new URL('./people.worker.ts', import.meta.url), { type: 'classic' });
    const init: PeopleRequest = {
      type: 'init',
      wasmLoader: new URL(wasmLoader, document.baseURI).href,
      wasmBinary: new URL(wasmBinary, document.baseURI).href,
      pose: pose!,
      face: face!,
    };
    const ready = await new Promise<PeopleReply>((resolve) => {
      w.onmessage = (e: MessageEvent<PeopleReply>) => resolve(e.data);
      w.onerror = (e) => resolve({ type: 'error', message: e.message || 'the analysis worker stopped' });
      w.postMessage(init, [pose!, face!]);
    });
    if (ready.type !== 'ready') {
      w.terminate();
      throw new Error(ready.type === 'error' ? ready.message : 'MediaPipe did not start');
    }
    w.onmessage = (e: MessageEvent<PeopleReply>) => {
      const r = e.data;
      if (r.type === 'heads') {
        pending.get(r.id)?.resolve(r.heads);
        pending.delete(r.id);
      } else if (r.type === 'error' && r.id !== undefined) {
        pending.get(r.id)?.reject(new Error(r.message));
        pending.delete(r.id);
      } else if (r.type === 'error') {
        workerFailed(w, new Error(r.message));
      }
    };
    // A crash (WASM abort, GPU process gone) answers nothing; don't leave anyone waiting.
    w.onerror = (e) => workerFailed(w, new Error(e.message || 'the analysis worker stopped'));
    w.onmessageerror = () => workerFailed(w, new Error('the analysis worker sent something unreadable'));
    return w;
  })();
  worker.catch(() => (worker = undefined));
  return worker;
}

/** The heads in a frame, in the bitmap's pixels. The bitmap goes to the worker. */
async function detect(bitmap: ImageBitmap, fresh: boolean): Promise<Heads> {
  const w = await peopleWorker();
  const id = nextId++;
  const answer = new Promise<Heads>((resolve, reject) => pending.set(id, { resolve, reject }));
  w.postMessage({ type: 'frame', id, bitmap, fresh } satisfies PeopleRequest, [bitmap]);
  return answer;
}

export async function analyseClip(file: WorkingFile, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<ClipAnalysis> {
  const response = await fetch(file.url);
  if (!response.ok) throw new Error(`loading the working file failed: ${response.status}`);
  const media = await demux(await response.arrayBuffer());
  // Started before decoding, so a worker that won't start fails the analysis right away.
  await peopleWorker();
  const source = new FrameSource(media);

  const rate = fps(file.frameRate);
  const every = Math.max(1, Math.round(rate / ANALYSIS_FPS));
  const thumbs: Uint8Array[] = [];
  const thumbCanvas = new OffscreenCanvas(THUMB_W, THUMB_H);
  const thumbContext = thumbCanvas.getContext('2d', { willReadFrequently: true })!;
  const scale = Math.min(1, MAX_WIDTH / media.width);

  const frames: AnalysedFrame[] = [];
  const inFlight = new Set<Promise<void>>();
  let failed: Error | undefined;
  /** A cut since the last frame sent (or the clip just began): pose starts over. */
  let fresh = true;

  try {
    for await (const { frame, index } of source.frames(0, source.frameCount)) {
      try {
        if (signal.aborted || failed) break;
        thumbContext.drawImage(frame, 0, 0, THUMB_W, THUMB_H);
        thumbs.push(grey(thumbContext.getImageData(0, 0, THUMB_W, THUMB_H).data));
        // The same test shotsOf() makes; it only has to say "something changed" here.
        if (index >= every && thumbDiff(thumbs[index]!, thumbs[index - every]!) >= CUT_DIFF) fresh = true;
        if (index % every !== 0) continue;
        const t = file.start + index / rate;
        const bitmap = await createImageBitmap(frame, scale < 1 ? { resizeWidth: Math.round(media.width * scale), resizeQuality: 'medium' } : {});
        const done: Promise<void> = detect(bitmap, fresh).then(
          (heads) => void frames.push({ t, heads: heads.map((h) => ({ box: { x: h.box.x / scale, y: h.box.y / scale, w: h.box.w / scale, h: h.box.h / scale }, mouth: h.mouth })) }),
          (e: unknown) => void (failed ??= e instanceof Error ? e : new Error(String(e))),
        );
        fresh = false;
        inFlight.add(done);
        void done.then(() => inFlight.delete(done));
        while (inFlight.size >= IN_FLIGHT) await Promise.race(inFlight);
        onProgress(index / source.frameCount);
      } finally {
        frame.close();
      }
    }
    await Promise.all(inFlight);
  } finally {
    source.close();
  }
  if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
  if (failed) throw failed;

  frames.sort((a, b) => a.t - b.t);
  const end = file.start + thumbs.length / rate;
  const shots = shotsOf(thumbs, rate, file.start, end);
  return {
    version: ANALYSIS_VERSION,
    start: file.start,
    end,
    width: media.width,
    height: media.height,
    shots,
    seats: seatsOf(frames, shots),
  };
}

/** RGBA to grey, as cut detection compares. */
function grey(rgba: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = (rgba[4 * i]! + rgba[4 * i + 1]! + rgba[4 * i + 2]!) / 3;
  return out;
}
