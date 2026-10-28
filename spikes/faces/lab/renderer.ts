/**
 * Face lab: runs MediaPipe over every clip at 10 frames per second and writes
 * per-frame results plus a debug video with the detections drawn on top.
 *
 * Three ways to find faces are compared on the same frames:
 *   full    FaceDetector on the whole frame (BlazeFace scales it to 128 px)
 *   naive   FaceLandmarker on the whole frame, the "just use MediaPipe" option
 *   tiles   FaceDetector on overlapping tiles, merged with the full-frame boxes
 * For every merged face, FaceLandmarker then runs on an enlarged crop around
 * it to measure how open the mouth is.
 *
 * Output: <media>/faces/<clip>.json and <clip>.debug.mp4
 */
import { ipcRenderer } from 'electron';
import { FaceDetector, FaceLandmarker, FilesetResolver, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mediaDir, modelsDir, repoRoot } from '../../shared/paths.ts';
import { ffmpegExe, ffprobeExe, run } from '../../shared/tools.ts';
import { listClips, type Clip } from '../../whisper/clips.ts';
import { containment, cropAround, headFromPose, iou, nms, tiles, Tracker, type Box, type Scored } from '../boxes.ts';

const FPS = 10;
const CROP_SIZE = 256;
const DEBUG_W = 960;
/** Mean absolute difference of 32x18 grey thumbnails above which we call it a cut. */
const CUT_THRESHOLD = 20;

const outDir = path.join(mediaDir, 'faces');
const logEl = document.getElementById('log')!;
const view = document.getElementById('view') as HTMLCanvasElement;

function log(message: string): void {
  console.log(message);
  logEl.textContent += `${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

/** VIDEO-mode tasks need strictly increasing timestamps, also across clips. */
let clock = 0;

async function createTasks() {
  const wasm = await FilesetResolver.forVisionTasks(
    pathToFileURL(path.join(repoRoot, 'spikes', 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')).href,
  );
  const model = async (name: string) => new Uint8Array(await readFile(path.join(modelsDir, 'mediapipe', name)));
  const detector = await model('blaze_face_short_range.tflite');
  const landmarker = await model('face_landmarker.task');
  const pose = async (name: string) => PoseLandmarker.createFromOptions(wasm, {
    baseOptions: { modelAssetBuffer: await model(name), delegate: 'GPU' },
    runningMode: 'VIDEO',
    numPoses: 4,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
  });

  return {
    poseLite: await pose('pose_landmarker_lite.task'),
    poseFull: await pose('pose_landmarker_full.task'),
    full: await FaceDetector.createFromOptions(wasm, {
      baseOptions: { modelAssetBuffer: detector, delegate: 'GPU' },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.5,
    }),
    tile: await FaceDetector.createFromOptions(wasm, {
      baseOptions: { modelAssetBuffer: detector, delegate: 'GPU' },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.5,
    }),
    naive: await FaceLandmarker.createFromOptions(wasm, {
      baseOptions: { modelAssetBuffer: landmarker, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 4,
    }),
    crop: await FaceLandmarker.createFromOptions(wasm, {
      baseOptions: { modelAssetBuffer: landmarker, delegate: 'GPU' },
      runningMode: 'IMAGE',
      numFaces: 1,
      outputFaceBlendshapes: true,
    }),
  };
}

type Tasks = Awaited<ReturnType<typeof createTasks>>;

async function videoSize(file: string) {
  const { stdout } = await run(ffprobeExe(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
  const [w, h] = stdout.trim().split(',').map(Number);
  return { w, h };
}

/** Decoded RGBA frames at FPS, read from FFmpeg with backpressure. */
async function* frames(file: string, w: number, h: number): AsyncGenerator<Uint8ClampedArray<ArrayBuffer>> {
  const size = w * h * 4;
  const ff = spawn(ffmpegExe(), ['-v', 'error', '-i', file, '-map', '0:v:0', '-vf', `fps=${FPS}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const queue: Uint8ClampedArray<ArrayBuffer>[] = [];
  let current = new Uint8ClampedArray(size);
  let filled = 0;
  let ended = false;
  let wake: (() => void) | undefined;

  ff.stdout.on('data', (chunk: Buffer) => {
    let offset = 0;
    while (offset < chunk.length) {
      const n = Math.min(size - filled, chunk.length - offset);
      current.set(chunk.subarray(offset, offset + n), filled);
      filled += n;
      offset += n;
      if (filled === size) {
        queue.push(current);
        current = new Uint8ClampedArray(size);
        filled = 0;
      }
    }
    if (queue.length > 4) ff.stdout.pause();
    wake?.();
  });
  ff.stdout.on('end', () => {
    ended = true;
    wake?.();
  });

  while (true) {
    const next = queue.shift();
    if (next) {
      if (queue.length < 2) ff.stdout.resume();
      yield next;
    } else if (ended) {
      return;
    } else {
      await new Promise<void>((r) => (wake = r));
      wake = undefined;
    }
  }
}

const dist = (a: NormalizedLandmark, b: NormalizedLandmark) => Math.hypot(a.x - b.x, a.y - b.y);
const toBox = (b: { originX: number; originY: number; width: number; height: number }, dx = 0, dy = 0): Box =>
  ({ x: b.originX + dx, y: b.originY + dy, w: b.width, h: b.height });

const COLORS = ['#ff4d4d', '#4dd2ff', '#ffd24d', '#7dff4d', '#ff4dff', '#ffffff', '#ff9f4d', '#4d79ff'];

async function analyze(clip: Clip, tasks: Tasks) {
  const { w, h } = await videoSize(clip.file);
  const full = new OffscreenCanvas(w, h);
  const fullCtx = full.getContext('2d', { willReadFrequently: true })!;
  const tileCanvas = new OffscreenCanvas(1, 1);
  const tileCtx = tileCanvas.getContext('2d')!;
  const cropCanvas = new OffscreenCanvas(CROP_SIZE, CROP_SIZE);
  const cropCtx = cropCanvas.getContext('2d')!;
  const thumb = new OffscreenCanvas(32, 18);
  const thumbCtx = thumb.getContext('2d', { willReadFrequently: true })!;

  const dw = DEBUG_W;
  const dh = Math.round((DEBUG_W * h) / w / 2) * 2;
  view.width = dw;
  view.height = dh;
  const dbg = view.getContext('2d', { willReadFrequently: true })!;
  const scale = dw / w;
  const encoder = spawn(ffmpegExe(), [
    '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${dw}x${dh}`, '-r', String(FPS), '-i', 'pipe:0',
    '-i', clip.file, '-map', '0:v', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(outDir, `${clip.id}.debug.mp4`),
  ], { stdio: ['pipe', 'ignore', 'inherit'] });
  const encoderDone = once(encoder, 'exit');

  const tileLevels = [tiles(w, h, 2), tiles(w, h, 4)];
  const tracker = new Tracker();
  const headTracker = new Tracker();
  let previousThumb: Uint8ClampedArray | undefined;
  const records = [];
  let k = 0;

  for await (const data of frames(clip.file, w, h)) {
    const t = k / FPS;
    clock += 1000 / FPS;
    fullCtx.putImageData(new ImageData(data, w, h), 0, 0);

    // Cut detection on tiny grey thumbnails.
    thumbCtx.drawImage(full, 0, 0, 32, 18);
    const th = thumbCtx.getImageData(0, 0, 32, 18).data;
    let diff = 0;
    if (previousThumb) {
      for (let i = 0; i < th.length; i += 4) diff += Math.abs(th[i] + th[i + 1] + th[i + 2] - previousThumb[i] - previousThumb[i + 1] - previousThumb[i + 2]) / 3;
      diff /= th.length / 4;
    }
    previousThumb = th;
    const cut = diff > CUT_THRESHOLD;
    if (cut) {
      tracker.cut();
      headTracker.cut();
    }

    const ms = { full: 0, naive: 0, tiles2: 0, tiles4: 0, crops: 0, poseLite: 0, poseFull: 0, headCrops: 0 };
    let t0 = performance.now();
    const fullDet: Scored[] = tasks.full.detectForVideo(full, clock).detections
      .map((d) => ({ ...toBox(d.boundingBox!), score: d.categories[0]?.score ?? 0 }));
    ms.full = performance.now() - t0;

    t0 = performance.now();
    const naiveCount = tasks.naive.detectForVideo(full, clock).faceLandmarks.length;
    ms.naive = performance.now() - t0;

    const detectTiles = (level: Box[]) => {
      const found: Scored[] = [];
      for (const tb of level) {
        tileCanvas.width = tb.w;
        tileCanvas.height = tb.h;
        tileCtx.drawImage(full, tb.x, tb.y, tb.w, tb.h, 0, 0, tb.w, tb.h);
        for (const d of tasks.tile.detect(tileCanvas).detections) {
          found.push({ ...toBox(d.boundingBox!, tb.x, tb.y), score: d.categories[0]?.score ?? 0 });
        }
      }
      return found;
    };
    t0 = performance.now();
    const tile2Det = detectTiles(tileLevels[0]);
    ms.tiles2 = performance.now() - t0;
    t0 = performance.now();
    const tile4Det = detectTiles(tileLevels[1]);
    ms.tiles4 = performance.now() - t0;

    const merged = nms([...fullDet, ...tile2Det, ...tile4Det], 0.3);

    // A candidate counts as a face only if the landmarker confirms it on a crop.
    t0 = performance.now();
    const checked = merged.map((face) => {
      const c = cropAround(face, w, h, 2);
      cropCtx.drawImage(full, c.x, c.y, c.w, c.h, 0, 0, CROP_SIZE, CROP_SIZE);
      const r = tasks.crop.detect(cropCanvas);
      const lm = r.faceLandmarks[0];
      const jaw = r.faceBlendshapes[0]?.categories.find((cat) => cat.categoryName === 'jawOpen')?.score;
      const near = (list: Scored[]) => list.some((f) => iou(f, face) > 0.3 || containment(f, face) > 0.6);
      return {
        id: 0,
        box: { x: Math.round(face.x), y: Math.round(face.y), w: Math.round(face.w), h: Math.round(face.h) },
        score: +face.score.toFixed(3),
        foundBy: [near(fullDet) && 'full', near(tile2Det) && 'tiles2', near(tile4Det) && 'tiles4'].filter(Boolean) as string[],
        landmarks: !!lm,
        // Inner-lip gap (landmarks 13/14) relative to face height (10/152).
        mouthOpen: lm ? +(dist(lm[13], lm[14]) / dist(lm[10], lm[152])).toFixed(4) : null,
        jawOpen: jaw !== undefined ? +jaw.toFixed(4) : null,
      };
    });
    ms.crops = performance.now() - t0;

    const faces = checked.filter((f) => f.landmarks);
    tracker.update(faces.map((f) => f.box)).forEach((id, i) => (faces[i].id = id));
    const rejected = checked.filter((f) => !f.landmarks);

    // People via pose: find each head from body landmarks, then look for the
    // face (and mouth) on a crop around it. Works for profiles and small faces
    // as long as the body is visible.
    t0 = performance.now();
    const liteCount = tasks.poseLite.detectForVideo(full, clock).landmarks.length;
    ms.poseLite = performance.now() - t0;
    t0 = performance.now();
    const poses = tasks.poseFull.detectForVideo(full, clock).landmarks;
    ms.poseFull = performance.now() - t0;
    t0 = performance.now();
    const heads = poses.flatMap((lm) => {
      const head = headFromPose(lm, w, h);
      if (!head) return [];
      const c = cropAround(head, w, h, 1.6);
      cropCtx.drawImage(full, c.x, c.y, c.w, c.h, 0, 0, CROP_SIZE, CROP_SIZE);
      const flm = tasks.crop.detect(cropCanvas).faceLandmarks[0];
      return [{
        id: 0,
        box: { x: Math.round(head.x), y: Math.round(head.y), w: Math.round(head.w), h: Math.round(head.h) },
        landmarks: !!flm,
        mouthOpen: flm ? +(dist(flm[13], flm[14]) / dist(flm[10], flm[152])).toFixed(4) : null,
        // Same person as a face the face detector confirmed?
        matchesFace: faces.some((f) => containment(f.box, head) > 0.5),
      }];
    });
    ms.headCrops = performance.now() - t0;
    headTracker.update(heads.map((hd) => hd.box)).forEach((id, i) => (heads[i].id = id));

    records.push({
      t: +t.toFixed(2), diff: +diff.toFixed(1), cut,
      fullCount: fullDet.length, naiveCount, tile2Count: tile2Det.length, tile4Count: tile4Det.length,
      liteCount, faces, rejected, heads, ms,
    });

    // Debug frame: solid box = found on the full frame, dashed = only on tiles,
    // grey = rejected by the landmarker. The bar next to a face is mouth opening.
    dbg.drawImage(full, 0, 0, dw, dh);
    for (const f of [...rejected, ...faces]) {
      const color = f.landmarks ? COLORS[f.id % COLORS.length] : '#888888';
      const x = f.box.x * scale;
      const y = f.box.y * scale;
      dbg.strokeStyle = color;
      dbg.lineWidth = f.landmarks ? 3 : 1;
      dbg.setLineDash(f.foundBy.includes('full') ? [] : [6, 4]);
      dbg.strokeRect(x, y, f.box.w * scale, f.box.h * scale);
      dbg.setLineDash([]);
      if (!f.landmarks) continue;
      dbg.fillStyle = color;
      dbg.fillRect(x + f.box.w * scale + 4, y + f.box.h * scale, 6, -Math.min((f.mouthOpen ?? 0) * 400, f.box.h * scale));
      dbg.font = '14px system-ui';
      dbg.fillText(`#${f.id} ${f.box.h}px ${f.mouthOpen?.toFixed(3)}`, x, y - 4);
    }
    // Pose heads: thick white-outlined boxes, label "P#id" and mouth opening.
    for (const hd of heads) {
      const x = hd.box.x * scale;
      const y = hd.box.y * scale;
      dbg.strokeStyle = '#ffffff';
      dbg.lineWidth = 4;
      dbg.strokeRect(x - 3, y - 3, hd.box.w * scale + 6, hd.box.h * scale + 6);
      dbg.strokeStyle = COLORS[hd.id % COLORS.length];
      dbg.lineWidth = 2;
      dbg.strokeRect(x - 3, y - 3, hd.box.w * scale + 6, hd.box.h * scale + 6);
      dbg.fillStyle = '#ffffff';
      dbg.font = 'bold 14px system-ui';
      dbg.fillText(`P#${hd.id} ${hd.mouthOpen !== null ? hd.mouthOpen.toFixed(3) : 'no face'}`, x, y + hd.box.h * scale + 18);
    }
    dbg.fillStyle = 'rgba(0,0,0,0.6)';
    dbg.fillRect(0, 0, dw, 22);
    dbg.fillStyle = cut ? '#ff4d4d' : '#ffffff';
    dbg.font = '14px monospace';
    dbg.fillText(`${t.toFixed(1)}s full:${fullDet.length} naive:${naiveCount} t2:${tile2Det.length} t4:${tile4Det.length} faces:${faces.length} rej:${rejected.length} pose:${liteCount}/${heads.length} diff:${diff.toFixed(0)}${cut ? ' CUT' : ''}`, 6, 16);
    const pixels = dbg.getImageData(0, 0, dw, dh).data;
    if (!encoder.stdin!.write(pixels)) await once(encoder.stdin!, 'drain');

    k++;
    if (k % 50 === 0) log(`  ${clip.id}: ${t.toFixed(0)} s`);
  }

  encoder.stdin!.end();
  await encoderDone;
  await writeFile(path.join(outDir, `${clip.id}.json`), JSON.stringify({ clip: clip.id, width: w, height: h, fps: FPS, tiles: tileLevels, frames: records }));
  log(`${clip.id}: ${k} frames analysed`);
}

async function main() {
  const args = new URLSearchParams(location.search).get('args') ?? '';
  const only = args.match(/--clips=(\S+)/)?.[1]?.split(',');
  await mkdir(outDir, { recursive: true });
  const tasks = await createTasks();
  log('MediaPipe ready');
  for (const clip of listClips().filter((c) => !only || only.includes(c.id))) {
    await analyze(clip, tasks);
  }
}

main().then(
  () => ipcRenderer.send('done', 0),
  (e) => {
    console.error(e?.stack ?? String(e));
    ipcRenderer.send('done', 1);
  },
);
