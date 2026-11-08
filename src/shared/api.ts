/**
 * The contract between the renderer and the main process. The renderer is
 * sandboxed and reaches the rest of the app only through `window.rezzo`,
 * which the preload script builds from these channel lists.
 */
import type { ClipAnalysis } from './analysis.ts';
import type { Asset, AssetFile, AssetKind, AssetStatus, AudioAsset, AudioInfo, VideoAsset, VideoInfo } from './assets.ts';
import type { Loudness } from './loudness.ts';
import type { SoundName } from './sounds.ts';
import type { LottieInfo } from './lottie.ts';
import type { OverlayLayout } from './overlay-files.ts';
import type { CustomFont } from './fonts.ts';
import type { FrameRate } from './frames.ts';
import type { Clip, Project, ProjectFormatError, Source, Transcript, TranscriptLanguage } from './project.ts';
import type { Settings } from './settings.ts';
import type { EpisodeVoices, SpeakerCount } from './voices.ts';
import type { Encoder, ThumbnailSize, TranscribeProgress, VoicesProgress } from './worker-api.ts';

export type OpenResult =
  | { ok: true; path: string; project: Project }
  | { ok: false; path: string; error: 'not-found' | 'unreadable' | ProjectFormatError['code'] };

export type SaveResult = { ok: true; path: string } | { ok: false; error: 'write-failed'; detail: string };

export type ImportResult = { ok: true; source: Source } | { ok: false; error: 'not-found' | 'unreadable' | 'no-video' };

export type LocateResult = ImportResult | { ok: false; error: 'different-file' };

/** "changed": the file is there but its size differs from when it was imported. */
export type SourceStatus = 'ok' | 'missing' | 'changed';

export interface TranscriptionStatus {
  /** Where whisper.cpp will run: an NVIDIA card, or the processor (much slower). */
  device: 'gpu' | 'cpu';
  /** Bytes still to download before the first transcription; 0 once installed. */
  downloadBytes: number;
}

export type TranscribeResult =
  | { ok: true; transcript: Transcript }
  | { ok: false; error: 'cancelled' | 'no-audio' }
  | { ok: false; error: 'download-failed' | 'whisper-failed'; detail: string };

export type VoicesResult =
  | { ok: true; voices: EpisodeVoices }
  | { ok: false; error: 'cancelled' | 'no-audio' }
  | { ok: false; error: 'failed'; detail: string };

/** A clip's working file: where to load it from and the stretch of the source it holds. */
export type PrepareResult =
  | { ok: true; url: string; start: number; end: number; frameRate: FrameRate }
  | { ok: false; error: 'cancelled' }
  | { ok: false; error: 'failed'; detail: string };

/** A video layer's working file: where to load it from, the seconds of the layer's file it holds, and its layout. */
export type OverlayPrepareResult =
  | { ok: true; url: string; start: number; end: number; frameRate: FrameRate; layout: OverlayLayout }
  | { ok: false; error: 'missing' | 'cancelled' }
  | { ok: false; error: 'failed'; detail: string };

export type ExportResult =
  | { ok: true; path: string; seconds: number; encoder: Encoder }
  | { ok: false; error: 'cancelled' | 'busy' }
  | { ok: false; error: 'failed'; detail: string };

/**
 * What the page renders for a running export. It arrives with the
 * MessagePort to the encoder as a window message of type EXPORT_PORT_MESSAGE.
 */
export interface ExportJob {
  clipId: string;
  /** The clip's working file, as in PrepareResult. */
  url: string;
  start: number;
  frameRate: FrameRate;
  /** Working-file frames to render, in order: `count` from `first` in each piece. */
  pieces: { first: number; count: number }[];
  /** All of them together. */
  count: number;
}

export const EXPORT_PORT_MESSAGE = 'rezzo:export-port';

/**
 * `missing`: BCS letters the font has no glyph for (it's added anyway).
 * "built-in": Rezzo already has this family.
 */
export type AddFontResult =
  | { ok: true; font: CustomFont; missing: string[] }
  | { ok: false; error: 'unreadable' }
  | { ok: false; error: 'built-in'; family: string };

/**
 * A file for a layer, and a URL the page can read it from; for a video,
 * also what ffprobe found, and for an animation what its JSON says.
 * "too-large": over the limit for its kind; "external-images": an
 * animation that shows image files kept beside it.
 */
export type AddAssetResult =
  | { ok: true; file: AssetFile; url: string; video?: VideoInfo; lottie?: LottieInfo; audio?: AudioInfo }
  | { ok: false; error: 'unreadable' | 'too-large' | 'too-long' | 'external-images' };

export type LocateAssetResult = AddAssetResult | { ok: false; error: 'different-file' };

export interface RecentProject {
  path: string;
  name: string;
  openedAt: string;
}

export interface RecoveredProject {
  /** The file it belongs to, or null if it was never saved. */
  filePath: string | null;
  savedAt: string;
  project: Project;
}

/** Request/response calls from the renderer, handled in the main process. */
export interface InvokeApi {
  'settings:get': () => Settings;
  'settings:set': (patch: Partial<Settings>) => Settings;

  /** Asks for a project file. Null: the user cancelled. */
  'project:choose': () => string | null;
  'project:open': (path: string) => OpenResult;
  /** Saves to `path`, or asks where when it's null ("Save as"). Null result: the user cancelled. */
  'project:save': (project: Project, path: string | null) => SaveResult | null;
  'project:recent': () => RecentProject[];
  'project:autosave': (project: Project, filePath: string | null) => void;
  'project:recovered': () => RecoveredProject[];
  'project:discard-recovery': (projectId: string) => void;

  /** Asks for a video file. Null: the user cancelled. */
  'episode:choose': () => string | null;
  'episode:import': (path: string) => ImportResult;
  'episode:check': (source: Source) => SourceStatus;
  /** Asks where the source went; only the same video is accepted. Null: cancelled. */
  'episode:locate': (source: Source) => LocateResult | null;
  /** A rezzo-media:// URL the page can play the source from. */
  'episode:media-url': (source: Source) => string;
  /** Makes (once) a playable 480p copy of the source; progress as episode:preview-progress. */
  'episode:preview': (source: Source) => string;
  /** A picture of the source at `time` seconds (a clip's card, or the export screen's `large` one), made once and kept in the cache. */
  'episode:thumbnail': (source: Source, time: number, size?: ThumbnailSize) => string;

  'transcribe:status': () => TranscriptionStatus;
  /** Runs until the transcript is ready; progress comes as transcribe:progress events. */
  'transcribe:start': (request: { projectId: string; source: Source; language: TranscriptLanguage }) => TranscribeResult;
  'transcribe:cancel': () => void;

  /**
   * Tells the episode's voices apart from the transcript (or finds the result
   * in the cache); progress comes as voices:progress events. A newer call
   * cancels an older one.
   */
  'voices:start': (request: { projectId: string; source: Source; transcript: Transcript; count: SpeakerCount }) => VoicesResult;
  'voices:cancel': () => void;

  /**
   * Makes (or finds in the cache) a working file holding this range of the
   * source; progress as clip:prepare-progress. A newer call from the same
   * window cancels an older one.
   */
  'clip:prepare': (source: Source, range: { start: number; end: number }) => PrepareResult;
  /**
   * Makes (or finds in the cache) the working file of a video layer's file
   * for `range` (seconds of that file, see overlayRange) at the clip's
   * frame rate; progress as overlay:prepare-progress with the same requestId.
   */
  'overlay:prepare': (asset: VideoAsset, range: { start: number; end: number }, frameRate: FrameRate, requestId: string) => OverlayPrepareResult;
  /** The page no longer needs that overlay:prepare; it resolves as "cancelled". */
  'overlay:cancel': (requestId: string) => void;

  /** URLs of MediaPipe's models, for the clip analysis. */
  'analysis:models': () => { pose: string; face: string };
  /** The cached analysis of the working file at this URL (from clip:prepare), or null. */
  'analysis:load': (workingUrl: string) => ClipAnalysis | null;
  'analysis:save': (workingUrl: string, analysis: ClipAnalysis) => void;

  /**
   * Asks where to save, then exports the clip; resolves when the file is
   * written. Progress of the working file comes as export:prepare-progress,
   * then the page gets an ExportJob to render. Null: the user cancelled the dialog.
   */
  'export:start': (source: Source, clip: Clip, assets: Asset[]) => ExportResult | null;
  'export:cancel': () => void;
  /** Shows the last exported file in Explorer. */
  'export:reveal': () => void;
  /** Opens the last exported file in the default player. */
  'export:open': () => void;

  /** Opens the third-party licenses that ship with this copy of the app. */
  'app:licenses': () => void;

  /** Asks for a TTF or OTF file and adds it to the fonts captions can use. Null: cancelled. */
  'fonts:add': () => AddFontResult | null;
  /** The bytes of an added font, by its `file` in the settings. */
  'fonts:read': (file: string) => Uint8Array;

  /** Asks for a file of this kind for a layer. Null: the user cancelled. */
  'asset:add': (kind: AssetKind) => AddAssetResult | null;
  'asset:check': (asset: AssetFile) => AssetStatus;
  /** Asks where a layer's file went; only the same file is accepted. Null: cancelled. */
  'asset:locate': (kind: AssetKind, asset: AssetFile) => LocateAssetResult | null;
  /** A rezzo-media:// URL the page can read a layer's file from. */
  'asset:url': (asset: AssetFile) => string;
  /** A rezzo-media:// URL the page can read a sound from the library from. */
  'sound:url': (name: SoundName) => string;
  /**
   * How loud the clip's own sound is over what it plays (shared/loudness.ts);
   * null when the source has none or the clip's working file isn't made yet.
   */
  'loudness:clip': (source: Source, clip: Clip) => Loudness | null;
  /** How loud a sound file of the user's is. */
  'loudness:asset': (asset: AudioAsset) => Loudness;

  /** The renderer listens for close requests from now on. Until then a window closes without asking it. */
  'app:listening': () => void;
  /** Closes the window for real, after the renderer has dealt with unsaved work. */
  'app:close': () => void;
}

/** Messages the main process pushes to the renderer. */
export interface EventApi {
  'settings:changed': Settings;
  /** The user tried to close the window; the renderer decides what happens. */
  'app:close-requested': null;
  'transcribe:progress': { projectId: string; progress: TranscribeProgress };
  'voices:progress': { projectId: string; progress: VoicesProgress };
  'episode:preview-progress': { fingerprint: string; fraction: number };
  'clip:prepare-progress': { fraction: number };
  'overlay:prepare-progress': { requestId: string; fraction: number };
  'export:prepare-progress': { fraction: number };
}

export type InvokeChannel = keyof InvokeApi;
export type EventChannel = keyof EventApi;
export type InvokeArgs<C extends InvokeChannel> = Parameters<InvokeApi[C]>;
export type InvokeResult<C extends InvokeChannel> = Awaited<ReturnType<InvokeApi[C]>>;

/** Runtime lists of the channels above; the preload script refuses anything else. */
export const INVOKE_CHANNELS = {
  'settings:get': true,
  'settings:set': true,
  'project:choose': true,
  'project:open': true,
  'project:save': true,
  'project:recent': true,
  'project:autosave': true,
  'project:recovered': true,
  'project:discard-recovery': true,
  'episode:choose': true,
  'episode:import': true,
  'episode:check': true,
  'episode:locate': true,
  'episode:media-url': true,
  'episode:preview': true,
  'episode:thumbnail': true,
  'transcribe:status': true,
  'transcribe:start': true,
  'transcribe:cancel': true,
  'voices:start': true,
  'voices:cancel': true,
  'clip:prepare': true,
  'overlay:prepare': true,
  'overlay:cancel': true,
  'analysis:models': true,
  'analysis:load': true,
  'analysis:save': true,
  'export:start': true,
  'export:cancel': true,
  'export:reveal': true,
  'export:open': true,
  'app:licenses': true,
  'fonts:add': true,
  'fonts:read': true,
  'asset:add': true,
  'asset:check': true,
  'asset:locate': true,
  'asset:url': true,
  'sound:url': true,
  'loudness:clip': true,
  'loudness:asset': true,
  'app:listening': true,
  'app:close': true,
} as const satisfies Record<InvokeChannel, true>;

export const EVENT_CHANNELS = {
  'settings:changed': true,
  'app:close-requested': true,
  'transcribe:progress': true,
  'voices:progress': true,
  'episode:preview-progress': true,
  'clip:prepare-progress': true,
  'overlay:prepare-progress': true,
  'export:prepare-progress': true,
} as const satisfies Record<EventChannel, true>;

/** What `window.rezzo` looks like to the renderer. */
export interface RezzoApi {
  invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>>;
  /** Subscribes to an event; returns a function that unsubscribes. */
  on<C extends EventChannel>(channel: C, listener: (payload: EventApi[C]) => void): () => void;
  /** The path of a file dropped on the window. */
  pathForFile(file: File): string;
}
