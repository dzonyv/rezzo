/**
 * Finds the people in a picture for a cover's cutout: MediaPipe's image
 * segmenter with the selfie multiclass model, which tells hair, skin and
 * clothes from the background. A person is anything that isn't
 * background. Runs off the page's thread, on the GPU when it can, like
 * the people analysis (analysis/people.worker.ts).
 */
import { ImageSegmenter } from '@mediapipe/tasks-vision';
import type { CutoutReply, CutoutRequest } from './cutout-messages.ts';

// The renderer's types are the page's; this is a dedicated worker's scope.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<CutoutRequest>) => void) | null;
  postMessage(message: CutoutReply, transfer?: Transferable[]): void;
};

/** The model's first confidence mask is the background. */
const BACKGROUND = 0;

let segmenter: ImageSegmenter | undefined;

async function init(msg: Extract<CutoutRequest, { type: 'init' }>): Promise<'GPU' | 'CPU'> {
  const fileset = { wasmLoaderPath: msg.wasmLoader, wasmBinaryPath: msg.wasmBinary };
  const model = new Uint8Array(msg.model);
  const make = async (delegate: 'GPU' | 'CPU') => {
    segmenter?.close();
    segmenter = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: model, delegate },
      canvas: delegate === 'GPU' ? new OffscreenCanvas(1, 1) : undefined,
      runningMode: 'IMAGE',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
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

function segment(msg: Extract<CutoutRequest, { type: 'segment' }>): Extract<CutoutReply, { type: 'mask' }> {
  if (!segmenter) throw new Error('not initialised');
  const result = segmenter.segment(new ImageData(msg.pixels, msg.width, msg.height));
  try {
    const background = result.confidenceMasks?.[BACKGROUND];
    if (!background) throw new Error('the segmenter gave no mask');
    const sure = background.getAsFloat32Array();
    const data = new Uint8Array(sure.length);
    for (let i = 0; i < sure.length; i++) data[i] = Math.round((1 - sure[i]!) * 255);
    return { type: 'mask', id: msg.id, data, width: background.width, height: background.height };
  } finally {
    result.close();
  }
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
    const reply = segment(msg);
    scope.postMessage(reply, [reply.data.buffer]);
  } catch (err) {
    scope.postMessage({ type: 'error', id: msg.id, message: String(err) });
  }
};
