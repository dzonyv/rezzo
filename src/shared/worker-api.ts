/**
 * Calls from the main process into the media worker (an Electron utility
 * process). Heavy or slow work runs there so the main process, which routes
 * every window event, never stalls.
 */
import type { FrameRate } from './frames.ts';
import type { Source, Transcript, TranscriptLanguage } from './project.ts';

/** What ffprobe tells us about a file; the rest of `Source` is added by the caller. */
export type ProbeResult = Omit<Source, 'path' | 'size' | 'fingerprint'>;

export interface TranscribeRequest {
  sourcePath: string;
  duration: number;
  language: TranscriptLanguage;
  /** Cache folder for this source (keyed by its fingerprint). */
  cacheDir: string;
  /** Folder whisper.cpp was unpacked into. */
  whisperDir: string;
  modelId: string;
  modelFile: string;
}

/** One stretch of the source to convert into a working file. */
export interface WorkingFileRequest {
  sourcePath: string;
  /** Source seconds of the first frame, on the frame grid. */
  start: number;
  duration: number;
  frameRate: FrameRate;
  /** From the source's probe; null when the file doesn't say. */
  colorSpace: string | null;
  height: number;
  out: string;
}

/** Where a transcription job is; downloads come first when tools are missing. */
export type TranscribeProgress =
  | { phase: 'download'; received: number; total: number }
  | { phase: 'audio' | 'transcribe'; fraction: number };

export interface WorkerMethods {
  /** Reads streams and duration. Fails with code "unreadable" or "no-video". */
  probe(file: string): ProbeResult;
  /** A content hash of the file (see workers/media/fingerprint.ts). */
  fingerprint(file: string): string;
  /** Installs a tool from tools.json into `dir`; reports DownloadProgress. */
  installTool(id: string, dir: string): void;
  /** Reports TranscribeProgress. Fails with code "whisper-failed" or "cancelled". */
  transcribe(request: TranscribeRequest): Transcript;
  /** Writes a 480p H.264 copy of the source to `out` unless it exists; reports 0..1. */
  makePreview(request: { sourcePath: string; duration: number; out: string }): void;
  /** Writes a working file to `request.out` unless it exists; reports 0..1. */
  makeWorkingFile(request: WorkingFileRequest): void;
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
