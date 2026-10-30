import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Animated, Clip, Layout } from '../../../shared/project.ts';
import { seekClip } from './playback.ts';

interface Props {
  clip: Clip;
  layout: Animated<Layout>;
  /** Keyframes of the value being edited. */
  keys: Animated<unknown>;
  time: number;
}

/**
 * The clip from start to end: which layout runs when (coloured bands), the
 * keyframes of the framing being edited (diamonds) and the playhead.
 * Press and drag anywhere to scrub.
 */
export function ClipTimeline({ clip, layout, keys, time }: Props) {
  const { t } = useTranslation();
  const track = useRef<HTMLDivElement>(null);
  const length = clip.end - clip.start;
  const at = (seconds: number) => `${((Math.min(Math.max(seconds, clip.start), clip.end) - clip.start) / length) * 100}%`;

  const seekTo = (clientX: number) => {
    const box = track.current!.getBoundingClientRect();
    const f = Math.min(Math.max((clientX - box.left) / box.width, 0), 1);
    seekClip(clip.start + f * length);
  };

  // Each layout keyframe starts a band that runs to the next one.
  const bands = layout.map((k, i) => ({ from: Math.max(k.t, clip.start), to: layout[i + 1]?.t ?? clip.end, layout: k.value }));

  return (
    <div
      ref={track}
      className="clip-timeline"
      role="slider"
      aria-label={t('clipEditor.timeline')}
      aria-valuemin={0}
      aria-valuemax={length}
      aria-valuenow={time - clip.start}
      tabIndex={-1}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        seekTo(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) seekTo(e.clientX);
      }}
    >
      {bands
        .filter((b) => b.to > clip.start && b.from < clip.end)
        .map((b) => (
          <div
            key={b.from}
            className={`band ${b.layout}`}
            style={{ left: at(b.from), width: `calc(${at(b.to)} - ${at(b.from)})` }}
            title={t(`clipEditor.layouts.${b.layout}`)}
          />
        ))}
      {keys
        .filter((k) => k.t >= clip.start && k.t <= clip.end)
        .map((k) => (
          <button
            key={k.t}
            type="button"
            className="key"
            style={{ left: at(k.t) }}
            aria-label={t('clipEditor.goToKeyframe')}
            title={t('clipEditor.goToKeyframe')}
            onPointerDown={(e) => {
              e.stopPropagation();
              seekClip(k.t);
            }}
          />
        ))}
      <div className="playhead" style={{ left: at(time) }} />
    </div>
  );
}
