/** From the page to cutout.worker.ts. */
export type CutoutRequest =
  | { type: 'init'; wasmLoader: string; wasmBinary: string; model: ArrayBuffer }
  /** RGBA, top row first. */
  | { type: 'segment'; id: number; pixels: Uint8ClampedArray<ArrayBuffer>; width: number; height: number };

/** Back from cutout.worker.ts. */
export type CutoutReply =
  | { type: 'ready'; delegate: 'GPU' | 'CPU' }
  /** How sure the segmenter is that each pixel is a person, 0..255, top row first. */
  | { type: 'mask'; id: number; data: Uint8Array<ArrayBuffer>; width: number; height: number }
  /** With an id: that picture failed. Without: the worker can't go on. */
  | { type: 'error'; id?: number; message: string };
