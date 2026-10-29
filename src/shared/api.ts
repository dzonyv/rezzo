/**
 * The contract between the renderer and the main process. The renderer is
 * sandboxed and reaches the rest of the app only through `window.rezzo`,
 * which the preload script builds from these channel lists.
 */
import type { Settings } from './settings.ts';

/** Request/response calls from the renderer, handled in the main process. */
export interface InvokeApi {
  'settings:get': () => Settings;
  'settings:set': (patch: Partial<Settings>) => Settings;
}

/** Messages the main process pushes to the renderer. */
export interface EventApi {
  'settings:changed': Settings;
}

export type InvokeChannel = keyof InvokeApi;
export type EventChannel = keyof EventApi;
export type InvokeArgs<C extends InvokeChannel> = Parameters<InvokeApi[C]>;
export type InvokeResult<C extends InvokeChannel> = Awaited<ReturnType<InvokeApi[C]>>;

/** Runtime lists of the channels above; the preload script refuses anything else. */
export const INVOKE_CHANNELS = {
  'settings:get': true,
  'settings:set': true,
} as const satisfies Record<InvokeChannel, true>;

export const EVENT_CHANNELS = {
  'settings:changed': true,
} as const satisfies Record<EventChannel, true>;

/** What `window.rezzo` looks like to the renderer. */
export interface RezzoApi {
  invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>>;
  /** Subscribes to an event; returns a function that unsubscribes. */
  on<C extends EventChannel>(channel: C, listener: (payload: EventApi[C]) => void): () => void;
}
