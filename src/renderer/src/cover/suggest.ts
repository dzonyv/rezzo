/**
 * Suggested frames for a clip's cover: the analysis' best moments
 * (shared/cover-suggest.ts) decoded from the working file, ranked again by
 * how sharp they are, each with a small picture to choose from.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ClipAnalysis } from '../../../shared/analysis.ts';
import { coverCandidates, rankWithSharpness, sharpness } from '../../../shared/cover-suggest.ts';
import type { ClipSpan } from '../../../shared/skips.ts';
import { workingFrameIndex } from '../../../shared/working.ts';
import type { WorkingFile } from '../render/clip-player.ts';
import type { Demuxed } from '../render/demux.ts';
import { FrameSource } from '../render/frame-source.ts';

/** How many suggestions are shown. */
export const SUGGESTIONS = 4;
/** How many of the analysis' best moments are decoded to pick them from. */
const DECODED = 10;
/** Width of the grey copy sharpness is measured on, and of the pictures shown. */
const MEASURE_W = 320;
const PICTURE_W = 240;

export interface Suggestion {
  t: number;
  /** A small JPG of the frame, as a data URL (the page's policy lets images come from those). */
  picture: string;
}

/** Decodes the candidates' frames, measures them and keeps the best SUGGESTIONS, in time order. `signal` stops it. */
export async function suggestCovers(clip: ClipSpan, analysis: ClipAnalysis, file: WorkingFile, media: Demuxed, signal: AbortSignal): Promise<Suggestion[]> {
  const candidates = coverCandidates(clip, analysis, DECODED);
  const frames = new FrameSource(media);
  const sharp: number[] = [];
  const pictures: string[] = [];
  try {
    for (const c of candidates) {
      signal.throwIfAborted();
      const index = Math.min(Math.max(0, workingFrameIndex(file, c.t)), frames.frameCount - 1);
      const frame = await frames.seek(index);
      try {
        const aspect = frame.displayHeight / frame.displayWidth;
        const measure = new OffscreenCanvas(MEASURE_W, Math.round(MEASURE_W * aspect));
        const m = measure.getContext('2d', { willReadFrequently: true })!;
        m.drawImage(frame, 0, 0, measure.width, measure.height);
        const rgba = m.getImageData(0, 0, measure.width, measure.height).data;
        const grey = new Uint8Array(measure.width * measure.height);
        for (let i = 0; i < grey.length; i++) grey[i] = (rgba[i * 4]! * 77 + rgba[i * 4 + 1]! * 150 + rgba[i * 4 + 2]! * 29) >> 8;
        sharp.push(sharpness(grey, measure.width, measure.height));
        const small = document.createElement('canvas');
        small.width = PICTURE_W;
        small.height = Math.round(PICTURE_W * aspect);
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
}

/**
 * The suggestions for the clip, once its analysis and working file are
 * there (null until then, and while they're being made); made again when
 * the clip's range or cuts change.
 */
export function useCoverSuggestions(clip: ClipSpan, analysis: ClipAnalysis | null, source: { file: WorkingFile; media: Demuxed } | null): Suggestion[] | null {
  // Made for these inputs; for any others they don't count.
  const [made, setMade] = useState<{ inputs: readonly unknown[]; list: Suggestion[] } | null>(null);
  // What they depend on, as a value that changes only when that does (not with every edit of the cover).
  const key = JSON.stringify({ start: clip.start, end: clip.end, skips: clip.skips });
  const span = useMemo(() => JSON.parse(key) as ClipSpan, [key]);
  useEffect(() => {
    if (!analysis || !source) return;
    const inputs = [span, analysis, source];
    const abort = new AbortController();
    suggestCovers(span, analysis, source.file, source.media, abort.signal).then(
      (list) => !abort.signal.aborted && setMade({ inputs, list }),
      // Not decodable: the cover can still be picked by hand.
      () => !abort.signal.aborted && setMade({ inputs, list: [] }),
    );
    return () => abort.abort();
  }, [span, analysis, source]);
  const current = made && made.inputs[0] === span && made.inputs[1] === analysis && made.inputs[2] === source;
  return current ? made.list : null;
}
