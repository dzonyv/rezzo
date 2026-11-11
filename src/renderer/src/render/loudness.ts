/**
 * How loud the open clip's own sound and the user's sound files are, and
 * where someone talks in the clip, from the page's side: asked of the main
 * process once (it measures in the media worker and remembers) and kept
 * here for the preview and the panels.
 */
import { useEffect } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { AudioAsset } from '../../../shared/assets.ts';
import { speechOf } from '../../../shared/ducking.ts';
import type { Loudness } from '../../../shared/loudness.ts';
import type { Clip, Source } from '../../../shared/project.ts';
import type { Span } from '../../../shared/skips.ts';

/** A measurement, or 'failed'; not there yet while it's being made. */
export type Measured = Loudness | 'failed';

/** By key (clipKey, assetKey); and each clip's latest, by clip id. */
export const loudnessStore = createStore<{ measured: ReadonlyMap<string, Measured>; latest: ReadonlyMap<string, Measured> }>()(() => ({
  measured: new Map(),
  latest: new Map(),
}));
const asking = new Set<string>();

/** Trimming a clip in small steps shouldn't measure it again for every step. */
const SETTLE_MS = 400;

/** What the clip's measurement depends on: the stretches of the source it plays. */
const clipKey = (source: Source, clip: Pick<Clip, 'start' | 'end' | 'skips'>) => `clip:${source.fingerprint}:${JSON.stringify([clip.start, clip.end, clip.skips])}`;
/** A file found somewhere else is measured again there; one that couldn't be read gets another try. */
const assetKey = (asset: AudioAsset) => `asset:${asset.fingerprint}:${asset.path}`;

/** Asks once for `key` (a clip's, with its id); an answer of null (not measurable yet) leaves it to be asked again. */
function ask(key: string, measure: () => Promise<Loudness | null>, clipId?: string): void {
  if (asking.has(key) || loudnessStore.getState().measured.has(key)) return;
  asking.add(key);
  const settle = (m: Measured | null) => {
    asking.delete(key);
    if (m) loudnessStore.setState(({ measured, latest }) => ({ measured: new Map(measured).set(key, m), latest: clipId ? new Map(latest).set(clipId, m) : latest }));
  };
  measure().then(settle, (e: unknown) => {
    console.warn('measuring loudness failed', e);
    settle('failed');
  });
}

/** Measures a sound file of the user's, unless it was. */
export const requestAssetLoudness = (asset: AudioAsset): void => ask(assetKey(asset), () => window.rezzo.invoke('loudness:asset', asset));

export const assetLoudnessOf = (measured: ReadonlyMap<string, Measured>, asset: AudioAsset): Measured | undefined => measured.get(assetKey(asset));

/**
 * How loud the clip's own sound is, measured once its working file is
 * there (`ready`) and only when it's evened out; undefined until then, and
 * for a source without sound.
 * While a trimmed clip is measured again, the last measurement stands in,
 * so the sound doesn't jump in between.
 */
export function useClipLoudness(source: Source, clip: Clip, ready: boolean): Measured | undefined {
  const key = clipKey(source, clip);
  useEffect(() => {
    if (!ready || !source.audio || !clip.evenLoudness) return;
    const again = loudnessStore.getState().latest.has(clip.id);
    const timer = setTimeout(() => ask(key, () => window.rezzo.invoke('loudness:clip', source, clip), clip.id), again ? SETTLE_MS : 0);
    return () => clearTimeout(timer);
    // The key holds everything the measurement depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, clip.evenLoudness]);
  return useStore(loudnessStore, (s) => s.measured.get(key) ?? s.latest.get(clip.id));
}

/** How loud a sound file of the user's is; asks for it when it isn't known yet. */
export function useAssetLoudness(asset: AudioAsset | undefined): Measured | undefined {
  useEffect(() => {
    if (asset) requestAssetLoudness(asset);
  }, [asset]);
  return useStore(loudnessStore, (s) => (asset ? assetLoudnessOf(s.measured, asset) : undefined));
}

/**
 * Where someone talks in the clip (shared/ducking.ts), in output time, by
 * clipKey: null when speech can't be told apart, 'failed' when measuring
 * failed; and each clip's latest, by clip id.
 */
export const speechStore = createStore<{ found: ReadonlyMap<string, Span[] | null | 'failed'>; latest: ReadonlyMap<string, Span[] | null | 'failed'> }>()(() => ({
  found: new Map(),
  latest: new Map(),
}));

/**
 * Where someone talks in the clip, found once its working file is there
 * (`ready`) and only when a sound is turned down under it (`wanted`);
 * undefined until then. Null when it can't be told, and also when
 * measuring failed: then nothing is turned down, as in the export. While a
 * trimmed clip is measured again, the last answer stands in.
 */
export function useClipSpeech(source: Source | null, clip: Clip, ready: boolean, wanted: boolean): Span[] | null | undefined {
  const key = source ? `levels:${clipKey(source, clip)}` : 'levels:none';
  useEffect(() => {
    if (!ready || !source?.audio || !wanted) return;
    if (asking.has(key) || speechStore.getState().found.has(key)) return;
    const again = speechStore.getState().latest.has(clip.id);
    const timer = setTimeout(() => {
      asking.add(key);
      const settle = (s: Span[] | null | 'failed' | undefined) => {
        asking.delete(key);
        // No working file yet: asked again later.
        if (s !== undefined) speechStore.setState(({ found, latest }) => ({ found: new Map(found).set(key, s), latest: new Map(latest).set(clip.id, s) }));
      };
      window.rezzo.invoke('loudness:levels', source, clip).then(
        (levels) => settle(levels === null ? undefined : speechOf(levels)),
        (e: unknown) => {
          console.warn('measuring speech failed', e);
          settle('failed');
        },
      );
    }, again ? SETTLE_MS : 0);
    return () => clearTimeout(timer);
    // The key holds everything the measurement depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, wanted]);
  const found = useStore(speechStore, (s) => s.found.get(key) ?? s.latest.get(clip.id));
  return found === 'failed' ? null : found;
}

/** A measurement as evenGain takes it: 'failed' counts as nothing measured. */
export const measuredLoudness = (m: Measured | undefined): Loudness | null => (m && m !== 'failed' ? m : null);
