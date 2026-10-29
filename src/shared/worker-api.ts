/**
 * Calls from the main process into the media worker (an Electron utility
 * process). Heavy or slow work runs there so the main process, which routes
 * every window event, never stalls.
 */
import type { Source } from './project.ts';

/** What ffprobe tells us about a file; the rest of `Source` is added by the caller. */
export type ProbeResult = Omit<Source, 'path' | 'size' | 'fingerprint'>;

export interface WorkerMethods {
  /** Reads streams and duration. Fails with code "unreadable" or "no-video". */
  probe(file: string): ProbeResult;
  /** A content hash of the file (see workers/media/fingerprint.ts). */
  fingerprint(file: string): string;
}

export type WorkerMethod = keyof WorkerMethods;

export type WorkerRequest =
  | { type: 'call'; id: number; method: WorkerMethod; args: unknown[] }
  | { type: 'cancel'; id: number };

export type WorkerReply =
  | { type: 'result'; id: number; value: unknown }
  | { type: 'error'; id: number; message: string; code?: string }
  | { type: 'progress'; id: number; progress: unknown };

/** An error that crossed from the worker; `code` is set for errors the UI explains. */
export class WorkerError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}
