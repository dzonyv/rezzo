/**
 * The contract between the renderer and the main process. The renderer is
 * sandboxed and reaches the rest of the app only through `window.rezzo`,
 * which the preload script builds from these channel lists.
 */
import type { Project, ProjectFormatError, Source, Transcript, TranscriptLanguage } from './project.ts';
import type { Settings } from './settings.ts';
import type { TranscribeProgress } from './worker-api.ts';

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

  'transcribe:status': () => TranscriptionStatus;
  /** Runs until the transcript is ready; progress comes as transcribe:progress events. */
  'transcribe:start': (request: { projectId: string; source: Source; language: TranscriptLanguage }) => TranscribeResult;
  'transcribe:cancel': () => void;

  /** Closes the window for real, after the renderer has dealt with unsaved work. */
  'app:close': () => void;
}

/** Messages the main process pushes to the renderer. */
export interface EventApi {
  'settings:changed': Settings;
  /** The user tried to close the window; the renderer decides what happens. */
  'app:close-requested': null;
  'transcribe:progress': { projectId: string; progress: TranscribeProgress };
  'episode:preview-progress': { fingerprint: string; fraction: number };
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
  'transcribe:status': true,
  'transcribe:start': true,
  'transcribe:cancel': true,
  'app:close': true,
} as const satisfies Record<InvokeChannel, true>;

export const EVENT_CHANNELS = {
  'settings:changed': true,
  'app:close-requested': true,
  'transcribe:progress': true,
  'episode:preview-progress': true,
} as const satisfies Record<EventChannel, true>;

/** What `window.rezzo` looks like to the renderer. */
export interface RezzoApi {
  invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>>;
  /** Subscribes to an event; returns a function that unsubscribes. */
  on<C extends EventChannel>(channel: C, listener: (payload: EventApi[C]) => void): () => void;
  /** The path of a file dropped on the window. */
  pathForFile(file: File): string;
}
