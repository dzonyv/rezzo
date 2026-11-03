import type { Box } from '../../../shared/heads.ts';

/** From the page to people.worker.ts. */
export type PeopleRequest =
  | { type: 'init'; wasmLoader: string; wasmBinary: string; pose: ArrayBuffer; face: ArrayBuffer }
  /** `fresh`: a new shot or clip starts here, forget the people being followed. */
  | { type: 'frame'; id: number; bitmap: ImageBitmap; fresh: boolean };

/** Back from people.worker.ts. Boxes are in the bitmap's pixels. */
export type PeopleReply =
  | { type: 'ready'; delegate: 'GPU' | 'CPU' }
  | { type: 'heads'; id: number; heads: { box: Box; mouth: number | null }[] }
  /** With an id: that frame failed. Without: the worker can't go on. */
  | { type: 'error'; id?: number; message: string };
