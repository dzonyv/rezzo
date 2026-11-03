import type { Box } from '../../../shared/heads.ts';

/** From the page to people.worker.ts. */
export type PeopleRequest =
  | { type: 'init'; wasmLoader: string; wasmBinary: string; pose: ArrayBuffer; face: ArrayBuffer }
  | { type: 'frame'; id: number; bitmap: ImageBitmap };

/** Back from people.worker.ts. Boxes are in the bitmap's pixels. */
export type PeopleReply =
  | { type: 'ready'; delegate: 'GPU' | 'CPU' }
  | { type: 'heads'; id: number; heads: { box: Box; mouth: number | null }[] }
  | { type: 'error'; message: string };
