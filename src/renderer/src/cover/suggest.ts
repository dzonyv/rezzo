/**
 * Suggested frames for a clip's cover: the analysis' best moments
 * (shared/cover-suggest.ts) decoded from the working file, ranked again by
 * how sharp they are, each with a small picture to choose from.
 */
import i18n from 'i18next';
import { useEffect, useMemo, useState } from 'react';
import { greyOf, type ClipAnalysis } from '../../../shared/analysis.ts';
import { coverCandidates, rankWithSharpness, sharpness, sharpnessRegion } from '../../../shared/cover-suggest.ts';
import type { ClipSpan } from '../../../shared/skips.ts';
import { workingFrameIndex } from '../../../shared/working.ts';
import type { WorkingFile } from '../render/clip-player.ts';
import type { Demuxed } from '../render/demux.ts';
import { FrameSource } from '../render/frame-source.ts';
import { notify } from '../ui/prompts.ts';
import { withSpareDecoder } from './spare-decoder.ts';

/** How many suggestions are shown. */
export const SUGGESTIONS = 4;
/** How many of the analysis' best moments are decoded to pick them from. */
const DECODED = 10;
/** Most pixels across the grey copy sharpness is measured on. */
const MEASURE_W = 320;
/** Width of the pictures shown. */
const PICTURE_W = 240;
/** Suggestions kept for clips edited lately, so going back to one doesn't decode its frames again. */
const KEPT = 8;

export interface Suggestion {
  t: number;
  /** A small JPG of the frame, as a data URL (the page's policy lets images come from those). */
  picture: string;
}

/** Decodes the candidates' frames, measures them and keeps the best SUGGESTIONS, in time order. `signal` stops it. */
export function suggestCovers(clip: ClipSpan, analysis: ClipAnalysis, file: WorkingFile, media: Demuxed, signal: AbortSignal): Promise<Suggestion[]> {
  // In time order: the decoder works through the file once rather than jumping back and forth.
  const candidates = coverCandidates(clip, analysis, DECODED).sort((a, b) => a.t - b.t);
  return withSpareDecoder(async () => {
    signal.throwIfAborted();
    const frames = new FrameSource(media);
    const sharp: number[] = [];
    const pictures: string[] = [];
    try {
      for (const c of candidates) {
        signal.throwIfAborted();
        const index = Math.min(Math.max(0, workingFrameIndex(file, c.t)), frames.frameCount - 1);
        const frame = await frames.seek(index);
        try {
          const region = sharpnessRegion(c, frame.displayWidth, frame.displayHeight);
          const scale = Math.min(1, MEASURE_W / region.w);
          const measure = new OffscreenCanvas(Math.max(3, Math.round(region.w * scale)), Math.max(3, Math.round(region.h * scale)));
          const m = measure.getContext('2d', { willReadFrequently: true })!;
          m.drawImage(frame, region.x, region.y, region.w, region.h, 0, 0, measure.width, measure.height);
          sharp.push(sharpness(greyOf(m.getImageData(0, 0, measure.width, measure.height).data), measure.width, measure.height));
          const small = document.createElement('canvas');
          small.width = PICTURE_W;
          small.height = Math.round((PICTURE_W * frame.displayHeight) / frame.displayWidth);
          small.getContext('2d')!.drawImage(frame, 0, 0, small.width, small.height);
          pictures.push(small.toDataURL('image/jpeg', 0.8));
        } finally {
          frame.close();
        }
      }
      signal.throwIfAborted();
      // The best few, shown in the order they come in the clip.
      return rankWithSharpness(candidates, sharp, SUGGESTIONS)
        .sort((a, b) => a.t - b.t)
        .map((b) => ({ t: b.t, picture: pictures[candidates.findIndex((c) => c.t === b.t)]! }));
    } finally {
      frames.close();
    }
  });
}

/** Suggestions made lately, by working file and clip span, least recently used first. */
const kept = new Map<string, { analysis: ClipAnalysis; list: Suggestion[] }>();

function keep(key: string, analysis: ClipAnalysis, list: Suggestion[]): void {
  kept.delete(key);
  kept.set(key, { analysis, list });
  for (const old of kept.keys()) {
    if (kept.size <= KEPT) break;
    kept.delete(old);
  }
}

/**
 * The suggestions for the clip, once its analysis and working file are
 * there (null until then, and while they're being made); made again when
 * the clip's range or cuts change, and kept for when it comes back.
 */
export function useCoverSuggestions(clip: ClipSpan, analysis: ClipAnalysis | null, source: { file: WorkingFile; media: Demuxed } | null): Suggestion[] | null {
  // Made for this key; for any other it doesn't count.
  const [made, setMade] = useState<{ key: string; list: Suggestion[] } | null>(null);
  // What they depend on, as a value that changes only when that does (not with every edit of the cover).
  const spanKey = JSON.stringify({ start: clip.start, end: clip.end, skips: clip.skips });
  const span = useMemo(() => JSON.parse(spanKey) as ClipSpan, [spanKey]);
  const key = source ? `${source.file.url} ${spanKey}` : null;
  const cached = key && analysis ? kept.get(key) : undefined;
  const ready = cached?.analysis === analysis ? cached.list : undefined;
  useEffect(() => {
    if (!analysis || !source || !key || ready) return;
    const abort = new AbortController();
    suggestCovers(span, analysis, source.file, source.media, abort.signal).then(
      (list) => {
        keep(key, analysis, list);
        if (!abort.signal.aborted) setMade({ key, list });
      },
      (e: unknown) => {
        if (abort.signal.aborted) return;
        // The cover can still be picked by hand; what went wrong is said.
        setMade({ key, list: [] });
        notify('error', i18n.t('cover.suggestFailed', { detail: e instanceof Error ? e.message : String(e) }));
      },
    );
    return () => abort.abort();
  }, [span, analysis, source, key, ready]);
  return ready ?? (made && made.key === key ? made.list : null);
}
