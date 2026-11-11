/**
 * Calls from the main process into the media worker (an Electron utility
 * process). Heavy or slow work runs there so the main process, which routes
 * every window event, never stalls.
 */
import type { AudioInfo, VideoInfo } from './assets.ts';
import type { GainPoint } from './ducking.ts';
import type { Loudness } from './loudness.ts';
import type { LottieInfo } from './lottie.ts';
import type { FrameRate } from './frames.ts';
import type { Source, Transcript, TranscriptLanguage } from './project.ts';
import type { EpisodeVoices, SpeakerCount, Span } from './voices.ts';

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

export interface VoicesRequest {
  sourcePath: string;
  duration: number;
  /** Cache folder for this source (keyed by its fingerprint). */
  cacheDir: string;
  /** The transcript's words joined into pieces (shared/voices.ts piecesOf). */
  pieces: Span[];
  count: SpeakerCount;
  /** sherpa-onnx's Node addon and the speaker embedding model. */
  addonFile: string;
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

/** A stretch of a video layer's file to convert into its working file. */
export interface OverlayFileRequest {
  path: string;
  /** From the asset's probe. */
  codec: string;
  colorSpace: string | null;
  /** The file's own height, for guessing its colour matrix when it doesn't say. */
  sourceHeight: number;
  alpha: boolean;
  /** Seconds into the file of the first frame, and how long. */
  start: number;
  duration: number;
  /** The clip's frame rate, which the file is converted to. */
  frameRate: FrameRate;
  /** The picture's size in the file (overlaySize). */
  width: number;
  height: number;
  out: string;
}

/** A file's sound to measure: all of it, or (`pieces`, seconds into the file) only those stretches, one after another. */
export interface LoudnessRequest {
  file: string;
  pieces: { start: number; duration: number }[] | null;
}

/** h264_nvenc on an NVIDIA card, libx264 everywhere else. */
export type Encoder = 'nvenc' | 'x264';

/**
 * A layer's sound in an export: `duration` seconds of `file` from `start`
 * on, heard from `at` seconds into the clip. With `loop` the file's first
 * `period` seconds play over and over. Volume and fades as in
 * shared/sound-mix.ts.
 */
export interface ExportSound {
  file: string;
  start: number;
  duration: number;
  loop: boolean;
  period: number;
  at: number;
  /** Volume times the gain that evens out its loudness (1 when that's off): 0 and up. */
  volume: number;
  /** Seconds, each at most half of `duration`. */
  fadeIn: number;
  fadeOut: number;
  /** Turned down while someone talks: the gain's corners in output time (shared/ducking.ts), or null. */
  duck: GainPoint[] | null;
}

/** One clip to encode. The frames come over the MessagePort sent with the call. */
export interface ExportRequest {
  /** The file the user chose; it's only replaced once the export has succeeded. */
  out: string;
  /** The clip's working file, where the sound comes from. */
  workingFile: string;
  /** The stretches of the working file the clip plays, in order, in seconds from its start. */
  audioPieces: { start: number; duration: number }[];
  /** All of them together. */
  duration: number;
  /** Whether the working file has sound (the source does). */
  hasAudio: boolean;
  /** The factor the clip's own sound is turned up or down by to even out its loudness; 1 when that's off. */
  gain: number;
  /** Video and sound layers' sound, mixed in over the clip's. */
  sounds: ExportSound[];
  frameRate: FrameRate;
  /** Frames the renderer will send. */
  frames: number;
  encoder: Encoder;
}

/**
 * Messages on an export's MessagePort. The renderer sends rendered frames
 * (yuv420p, 1080×1920) and the worker acknowledges each one once FFmpeg
 * has taken it, which keeps a bounded number of frames in flight.
 */
export type ExportPortRequest =
  | { type: 'frame'; data: Uint8Array }
  | { type: 'end' }
  | { type: 'fail'; message: string };

export type ExportPortReply = { type: 'ack' } | { type: 'error'; message: string };

/** Where a transcription job is; downloads come first when tools are missing. */
export type TranscribeProgress =
  | { phase: 'download'; received: number; total: number }
  | { phase: 'audio' | 'transcribe'; fraction: number };

/** Where telling voices apart is: the audio comes first if the cache lost it. */
export type VoicesProgress = { phase: 'audio' | 'voices'; fraction: number };

export interface WorkerMethods {
  /** Reads streams and duration. Fails with code "unreadable" or "no-video". */
  probe(file: string): ProbeResult;
  /** Reads a video layer's file, alpha included. Fails like probe. */
  probeVideo(file: string): VideoInfo;
  /** Reads a sound layer's file. Fails with code "unreadable". */
  probeAudio(file: string): AudioInfo;
  /** What a Lottie animation's file says about it (workers/media/lottie-file.ts); null when it isn't one. */
  readLottie(file: string): LottieInfo | 'external-images' | null;
  /** A content hash of the file (see workers/media/fingerprint.ts). */
  fingerprint(file: string): string;
  /** Installs a tool from tools.json into `dir`; reports DownloadProgress. */
  installTool(id: string, dir: string): void;
  /** Reports TranscribeProgress. Fails with code "whisper-failed" or "cancelled". */
  transcribe(request: TranscribeRequest): Transcript;
  /** Reports VoicesProgress. Fails with code "voices-failed" or "cancelled". */
  diarize(request: VoicesRequest): EpisodeVoices;
  /** Writes a 480p H.264 copy of the source to `out` unless it exists; reports 0..1. */
  makePreview(request: { sourcePath: string; duration: number; out: string }): void;
  /** Writes one frame of the source at `time` to `out` as a JPEG at most `height` tall, unless it exists. */
  makeThumbnail(request: { sourcePath: string; time: number; height: number; out: string }): void;
  /** Writes a working file to `request.out` unless it exists; reports 0..1. */
  makeWorkingFile(request: WorkingFileRequest): void;
  /** Writes a video layer's working file to `request.out` unless it exists; reports 0..1. */
  makeOverlayFile(request: OverlayFileRequest): void;
  /** Integrated loudness and true peak (shared/loudness.ts). */
  measureLoudness(request: LoudnessRequest): Loudness;
  /** The sound's level in dB every DUCK_STEP, for finding speech (shared/ducking.ts). */
  measureLevels(request: LoudnessRequest): number[];
  /** NVENC if a quick test encode works, else x264. Decided once per run. */
  pickEncoder(): Encoder;
  /**
   * Encodes the frames arriving on the MessagePort sent with the call into
   * `request.out`. Fails with code "cancelled", "frame-count" or "ffmpeg-failed".
   */
  encodeExport(request: ExportRequest): void;
}

export type WorkerMethod = keyof WorkerMethods;

/**
 * Heights of a clip's picture, in pixels (smaller sources keep theirs); the
 * width follows the source. A card's is small; the export screen fills a
 * 9:16 frame about 600 px tall with the large one.
 */
export const THUMBNAIL_HEIGHTS = { card: 240, large: 720 } as const;
export type ThumbnailSize = keyof typeof THUMBNAIL_HEIGHTS;

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
