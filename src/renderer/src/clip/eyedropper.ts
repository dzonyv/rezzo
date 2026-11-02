/**
 * Picking a green screen's colour from the preview. The inspector starts
 * it for a layer; the next click on that layer in the preview takes the
 * colour of the layer's own picture there (before its key and before
 * anything drawn over it), which the preview reads from the compositor.
 */
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/** The layer whose key colour is being picked, or null. */
export const eyedropperStore = createStore<{ layerId: string | null }>()(() => ({ layerId: null }));

export const usePicking = (): string | null => useStore(eyedropperStore, (s) => s.layerId);

export function startPicking(layerId: string): void {
  eyedropperStore.setState({ layerId });
}

export function stopPicking(): void {
  eyedropperStore.setState({ layerId: null });
}

/** Reads a layer's own picture at (u, v), 0..1 from its top left: RGB 0..255, or null when it has none on screen. */
export type LayerSampler = (layerId: string, assetId: string, u: number, v: number) => [number, number, number] | null;

let sampler: LayerSampler | null = null;

/** The preview sets this while it has a compositor. */
export function setSampler(next: LayerSampler | null): void {
  sampler = next;
}

/** The colour at (u, v) of the layer's picture as "#rrggbb", or null. */
export function sampleColor(layerId: string, assetId: string, u: number, v: number): string | null {
  const rgb = sampler?.(layerId, assetId, u, v);
  return rgb ? `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}` : null;
}
