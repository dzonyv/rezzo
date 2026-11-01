/**
 * The app settings as the page last heard them, for the parts of the UI
 * that need them while rendering (caption styles, fonts). The main process
 * owns them and says when they change.
 */
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Settings } from '../../shared/settings.ts';

export const settingsStore = createStore<{ settings: Settings | null }>()(() => ({ settings: null }));

export function useSettings<T>(select: (s: Settings) => T): T | undefined {
  return useStore(settingsStore, (s) => (s.settings ? select(s.settings) : undefined));
}

export const currentSettings = (): Settings | null => settingsStore.getState().settings;

/** Keeps the store up to date; called once at start-up. */
export function trackSettings(initial: Settings): void {
  settingsStore.setState({ settings: initial });
  window.rezzo.on('settings:changed', (settings) => settingsStore.setState({ settings }));
}

export function setSettings(patch: Partial<Omit<Settings, 'exportDir' | 'fonts'>>): Promise<Settings> {
  return window.rezzo.invoke('settings:set', patch);
}
