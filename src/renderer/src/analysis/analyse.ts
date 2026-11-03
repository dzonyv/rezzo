/**
 * Analyses a clip's working file: camera cuts from a tiny grey thumbnail of
 * every frame, and the people in each shot from MediaPipe at ANALYSIS_FPS
 * (people.worker.ts). Decodes with its own FrameSource, so playback in the
 * editor isn't disturbed.
 */
import wasmBinary from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import wasmLoader from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import { ANALYSIS_FPS, ANALYSIS_VERSION, seatsOf, shotsOf, THUMB_H, THUMB_W, type AnalysedFrame, type ClipAnalysis } from '../../../shared/analysis.ts';
import { fps } from '../../../shared/frames.ts';
import type { WorkingFile } from '../render/clip-player.ts';
import { demux } from '../render/demux.ts';
import { FrameSource } from '../render/frame-source.ts';
import type { PeopleReply, PeopleRequest } from './people-messages.ts';

/** Frames handed to the worker and not answered yet; keeps the decoder ahead without piling up bitmaps. */
const IN_FLIGHT = 3;
/** Frames go to pose no wider than this; heads in a 4K source are big enough at half size. */
const MAX_WIDTH = 1920;

let worker: Promise<{ worker: Worker; delegate: 'GPU' | 'CPU' }> | undefined;

/** One worker for the session; the models load once. */
function peopleWorker(): Promise<{ worker: Worker; delegate: 'GPU' | 'CPU' }> {
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
      w.postMessage(init, [pose!, face!]);
    });
    if (ready.type !== 'ready') {
      w.terminate();
      throw new Error(ready.type === 'error' ? ready.message : 'MediaPipe did not start');
    }
    return { worker: w, delegate: ready.delegate };
  })();
  worker.catch(() => (worker = undefined));
  return worker;
}

export async function analyseClip(file: WorkingFile, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<ClipAnalysis> {
  const response = await fetch(file.url);
  if (!response.ok) throw new Error(`loading the working file failed: ${response.status}`);
  const media = await demux(await response.arrayBuffer());
  const source = new FrameSource(media);
  const { worker: w } = await peopleWorker();

  const rate = fps(file.frameRate);
  const every = Math.max(1, Math.round(rate / ANALYSIS_FPS));
  const thumbs: Uint8Array[] = [];
  const thumbCanvas = new OffscreenCanvas(THUMB_W, THUMB_H);
  const thumbContext = thumbCanvas.getContext('2d', { willReadFrequently: true })!;
  const scale = Math.min(1, MAX_WIDTH / media.width);

  const frames: AnalysedFrame[] = [];
  const waiting = new Map<number, (r: PeopleReply) => void>();
  let failed: Error | undefined;
  w.onmessage = (e: MessageEvent<PeopleReply>) => {
    const r = e.data;
    if (r.type === 'heads') {
      waiting.get(r.id)?.(r);
      waiting.delete(r.id);
    } else if (r.type === 'error') {
      failed = new Error(r.message);
      for (const resolve of waiting.values()) resolve(r);
      waiting.clear();
    }
  };
  const inFlight = new Set<Promise<void>>();

  try {
    for await (const { frame, index } of source.frames(0, source.frameCount)) {
      try {
        if (signal.aborted || failed) break;
        thumbContext.drawImage(frame, 0, 0, THUMB_W, THUMB_H);
        thumbs.push(grey(thumbContext.getImageData(0, 0, THUMB_W, THUMB_H).data));
        if (index % every === 0) {
          const t = file.start + index / rate;
          const bitmap = await createImageBitmap(frame, scale < 1 ? { resizeWidth: Math.round(media.width * scale), resizeQuality: 'medium' } : {});
          const answered = new Promise<void>((resolve) => {
            waiting.set(index, (r) => {
              if (r.type === 'heads') {
                const heads = r.heads.map((h) => ({ box: { x: h.box.x / scale, y: h.box.y / scale, w: h.box.w / scale, h: h.box.h / scale }, mouth: h.mouth }));
                frames.push({ t, heads });
              }
              resolve();
            });
          });
          w.postMessage({ type: 'frame', id: index, bitmap } satisfies PeopleRequest, [bitmap]);
          inFlight.add(answered);
          void answered.then(() => inFlight.delete(answered));
          while (inFlight.size >= IN_FLIGHT) await Promise.race(inFlight);
          onProgress(index / source.frameCount);
        }
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
  const shots = shotsOf(thumbs, rate, file.start, file.start + thumbs.length / rate);
  return {
    version: ANALYSIS_VERSION,
    start: file.start,
    end: file.start + thumbs.length / rate,
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
