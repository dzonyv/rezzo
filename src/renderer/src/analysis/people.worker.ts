/**
 * Finds the people in a frame: MediaPipe Pose on the whole picture for the
 * heads (it works in profile and in wide shots, where face detectors don't),
 * then the Face Landmarker on a crop around each head big enough to measure
 * the mouth (spikes/REPORT.md, 0b). Runs off the page's thread; the GPU
 * delegate works through OffscreenCanvas here.
 */
import { FaceLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { cropAround, headFromPose, mouthOpening, type Box } from '../../../shared/heads.ts';
import type { PeopleReply, PeopleRequest } from './people-messages.ts';

// The renderer's types are the page's; this is a dedicated worker's scope.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<PeopleRequest>) => void) | null;
  postMessage(message: PeopleReply): void;
};

/** Heads smaller than this (in frame pixels) are too small for the Face Landmarker (Phase 0: it gives up below ~55). */
const MIN_FACE = 48;
/** The crop around a head, in head sizes, and the size the landmarker gets it at. */
const CROP_SCALE = 1.6;
const CROP_SIZE = 256;

let pose: PoseLandmarker | undefined;
let face: FaceLandmarker | undefined;
const crop = new OffscreenCanvas(CROP_SIZE, CROP_SIZE);
const cropContext = crop.getContext('2d')!;
/** VIDEO mode needs timestamps that always go up, across clips too. */
let clock = 0;

async function init(msg: Extract<PeopleRequest, { type: 'init' }>): Promise<'GPU' | 'CPU'> {
  const fileset = { wasmLoaderPath: msg.wasmLoader, wasmBinaryPath: msg.wasmBinary };
  const make = async (delegate: 'GPU' | 'CPU') => {
    pose?.close();
    face?.close();
    pose = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: new Uint8Array(msg.pose), delegate },
      canvas: delegate === 'GPU' ? new OffscreenCanvas(1, 1) : undefined,
      runningMode: 'VIDEO',
      numPoses: 4,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    face = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: new Uint8Array(msg.face), delegate },
      canvas: delegate === 'GPU' ? new OffscreenCanvas(1, 1) : undefined,
      runningMode: 'IMAGE',
      numFaces: 1,
    });
  };
  try {
    await make('GPU');
    return 'GPU';
  } catch (e) {
    console.warn('MediaPipe on the GPU failed, using the CPU', e);
    await make('CPU');
    return 'CPU';
  }
}

function heads(bitmap: ImageBitmap): { box: Box; mouth: number | null }[] {
  if (!pose || !face) throw new Error('not initialised');
  clock += 100;
  const found = pose.detectForVideo(bitmap, clock);
  const out: { box: Box; mouth: number | null }[] = [];
  for (const landmarks of found.landmarks) {
    const box = headFromPose(landmarks, bitmap.width, bitmap.height);
    if (!box) continue;
    let mouth: number | null = null;
    if (Math.max(box.w, box.h) >= MIN_FACE) {
      const c = cropAround(box, bitmap.width, bitmap.height, CROP_SCALE);
      cropContext.drawImage(bitmap, c.x, c.y, c.w, c.h, 0, 0, CROP_SIZE, CROP_SIZE);
      const lm = face.detect(crop).faceLandmarks[0];
      if (lm) mouth = mouthOpening(lm);
    }
    out.push({ box, mouth });
  }
  return out;
}

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    init(msg).then(
      (delegate) => scope.postMessage({ type: 'ready', delegate }),
      (err: unknown) => scope.postMessage({ type: 'error', message: String(err) }),
    );
    return;
  }
  try {
    scope.postMessage({ type: 'heads', id: msg.id, heads: heads(msg.bitmap) });
  } catch (err) {
    scope.postMessage({ type: 'error', message: String(err) });
  } finally {
    msg.bitmap.close();
  }
};
