import { memo, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { Clip } from '../../../shared/project.ts';
import type { VoiceTurn } from '../../../shared/voices.ts';
import { openClip } from '../clip/state.ts';
import { formatDuration } from '../format.ts';
import { playbackStore, seek, usePlayback } from '../player/playback.ts';
import { useHeardVoices } from '../project/voices.ts';
import { useHits } from '../transcript/hits.ts';
import { voiceColor } from '../voice-colors.ts';

/** Arrow keys on the strip move by this much. */
const STEP_SECONDS = 5;

/**
 * The whole episode across the bottom of the episode screen: the clips on
 * top, and under them who talks when, where the search found something,
 * and the playhead. Press or drag on it to go somewhere.
 */
export function EpisodeStrip({ duration, clips }: { duration: number; clips: readonly Clip[] }) {
  const { t } = useTranslation();
  const heard = useHeardVoices();
  const lane = useRef<HTMLDivElement>(null);
  // For the slider's value; the parts drawn inside are memoized, so this re-renders little.
  const second = usePlayback((s) => Math.floor(s.time));

  const timeAt = (clientX: number) => {
    const box = lane.current!.getBoundingClientRect();
    return Math.min(Math.max((clientX - box.left) / box.width, 0), 1) * duration;
  };

  // A source that says it lasts nothing has nowhere to go.
  if (!(duration > 0)) return null;
  return (
    <section className="episode-strip" aria-label={t('strip.title')}>
      <ClipMarks clips={clips} duration={duration} />
      <div
        ref={lane}
        className="strip-lane"
        role="slider"
        tabIndex={0}
        aria-label={t('strip.title')}
        aria-valuemin={0}
        aria-valuemax={Math.floor(duration)}
        aria-valuenow={second}
        aria-valuetext={formatDuration(second)}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          seek(timeAt(e.clientX));
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) seek(timeAt(e.clientX));
        }}
        onKeyDown={(e) => {
          const now = playbackStore.getState().time;
          const to = e.key === 'ArrowLeft' ? now - STEP_SECONDS : e.key === 'ArrowRight' ? now + STEP_SECONDS : e.key === 'Home' ? 0 : e.key === 'End' ? duration : null;
          if (to === null) return;
          e.preventDefault();
          seek(Math.min(Math.max(to, 0), duration));
        }}
      >
        {heard && <Turns turns={heard.turns} duration={duration} />}
        <Hits duration={duration} />
        <Playhead duration={duration} />
      </div>
    </section>
  );
}

/** Where `start`..`end` sits on the strip, as CSS. */
function span(start: number, end: number, duration: number): CSSProperties {
  return { left: `${(start / duration) * 100}%`, width: `${((end - start) / duration) * 100}%` };
}

/** The clips, in yellow over the lane; one opens its clip. */
const ClipMarks = memo(function ClipMarks({ clips, duration }: { clips: readonly Clip[]; duration: number }) {
  const { t } = useTranslation();
  return (
    <div className="strip-clips">
      {clips.map((clip) => (
        <button
          key={clip.id}
          type="button"
          style={span(clip.start, clip.end, duration)}
          aria-label={t('strip.openClip', { name: clip.name || t('clips.untitled') })}
          title={clip.name || t('clips.untitled')}
          onClick={() => {
            openClip(clip.id);
            seek(clip.start);
          }}
        />
      ))}
    </div>
  );
});

/** Who talks when, one block per turn in the voice's colour. Drawn again only when the turns change. */
const Turns = memo(function Turns({ turns, duration }: { turns: readonly VoiceTurn[]; duration: number }) {
  return (
    <>
      {turns.map((turn) => (
        <i key={turn.start} className="turn" style={{ ...span(turn.start, turn.end, duration), background: voiceColor(turn.voice) }} />
      ))}
    </>
  );
});

/** A thin line at each search match; the one the transcript shows is taller. */
const Hits = memo(function Hits({ duration }: { duration: number }) {
  const times = useHits((s) => s.times);
  const current = useHits((s) => s.current);
  return (
    <>
      {times.map((time, i) => (
        <i key={i} className={i === current ? 'hit current' : 'hit'} style={{ left: `${(time / duration) * 100}%` }} />
      ))}
    </>
  );
});

function Playhead({ duration }: { duration: number }) {
  const time = usePlayback((s) => s.time);
  return <i className="playhead" style={{ left: `${(Math.min(time, duration) / duration) * 100}%` }} />;
}
