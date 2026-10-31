import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { snapToFrame, type FrameRate } from '../../../shared/frames.ts';
import type { Clip, Transcript } from '../../../shared/project.ts';
import { projectStore } from '../project/store.ts';
import { retimeWord } from '../project/transcript.ts';
import { PEAKS_PER_SECOND } from '../render/clip-player.ts';
import { startEditing } from '../transcript/editing.ts';
import { flatOf, refOf, wordAt } from '../transcript/words.ts';
import { currentPlayer, seekClip, useClipPlayback } from './playback.ts';

/** Seconds of sound the strip shows around the playhead. */
const WINDOW_SECONDS = 6;
const EDGES = ['start', 'end'] as const;

interface Drag {
  index: number;
  edge: 'start' | 'end';
}

/**
 * A close-up of the sound around the playhead with the words over it, for
 * fixing their timing: drag either edge of a word. Click a word to go to
 * it, double-click it to correct its text in the transcript.
 */
export function WordStrip({ clip, transcript, time, rate }: { clip: Clip; transcript: Transcript; time: number; rate: FrameRate }) {
  const { t } = useTranslation();
  const track = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  const ready = useClipPlayback((s) => s.status === 'ready');

  const flat = flatOf(transcript.segments);
  // The window follows the playhead but stays inside the clip.
  const span = Math.min(WINDOW_SECONDS, clip.end - clip.start);
  const from = Math.min(Math.max(time - span / 2, clip.start), clip.end - span);
  const to = from + span;
  const x = (seconds: number) => ((seconds - from) / span) * width;

  const first = Math.max(0, wordAt(flat.words, from));
  const visible = [];
  for (let i = first; i < flat.words.length && flat.words[i]!.start < to; i++) {
    if (flat.words[i]!.end > from) visible.push(flat.words[i]!);
  }
  // The word being dragged stays even when it's pulled out of view, or its edge
  // would vanish under the pointer and the drag would never end.
  const dragged = drag && flat.words[drag.index];
  if (dragged && !visible.includes(dragged)) visible.push(dragged);
  const active = wordAt(flat.words, time);

  useEffect(() => {
    const el = track.current!;
    const resize = new ResizeObserver(() => setWidth(el.clientWidth));
    resize.observe(el);
    return () => resize.disconnect();
  }, []);

  // A drag that ends any other way (the strip closing under it) still closes its undo step.
  const dragging = useRef(false);
  const endDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    projectStore.getState().endGesture();
    setDrag(null);
  };
  useEffect(
    () => () => {
      if (dragging.current) projectStore.getState().endGesture();
    },
    [],
  );

  // The waveform: one bar per pixel column, as tall as the loudest sound in it.
  useEffect(() => {
    const el = canvas.current!;
    const peaks = ready ? currentPlayer()?.peaks : null;
    const player = currentPlayer();
    el.width = Math.round(width * devicePixelRatio);
    el.height = Math.round(el.clientHeight * devicePixelRatio);
    const ctx = el.getContext('2d')!;
    ctx.clearRect(0, 0, el.width, el.height);
    if (!peaks || !player) return;
    ctx.fillStyle = getComputedStyle(el).color;
    const mid = el.height / 2;
    for (let px = 0; px < el.width; px++) {
      const a = Math.floor((from + (px / el.width) * span - player.file.start) * PEAKS_PER_SECOND);
      const b = Math.max(a + 1, Math.floor((from + ((px + 1) / el.width) * span - player.file.start) * PEAKS_PER_SECOND));
      let peak = 0;
      for (let i = Math.max(a, 0); i < Math.min(b, peaks.length); i++) peak = Math.max(peak, peaks[i]!);
      const h = Math.max(1, peak * mid);
      ctx.fillRect(px, mid - h, 1, h * 2);
    }
  }, [ready, width, from, span]);

  const timeAt = (clientX: number) => {
    const box = track.current!.getBoundingClientRect();
    return snapToFrame(from + ((clientX - box.left) / box.width) * span, rate);
  };

  const move = (d: Drag, clientX: number) => {
    const word = flat.words[d.index];
    if (!word) return;
    const at = timeAt(clientX);
    retimeWord(refOf(flat, d.index), d.edge === 'start' ? at : word.start, d.edge === 'end' ? at : word.end);
  };

  return (
    <div ref={track} className="word-strip" aria-label={t('clipEditor.wordStrip')}>
      <canvas ref={canvas} aria-hidden="true" />
      {visible.map((w) => (
        <div
          key={w.index}
          className={w.index === active ? 'word active' : 'word'}
          style={{ left: x(w.start), width: Math.max(2, x(w.end) - x(w.start)) }}
          title={t('clipEditor.wordHelp')}
          data-word={w.index}
          onClick={() => seekClip(w.start)}
          onDoubleClick={() => startEditing(w.index)}
        >
          <span>{w.text}</span>
          {EDGES.map((edge) => (
            <div
              key={edge}
              className={`edge ${edge}`}
              role="separator"
              aria-label={t(`clipEditor.${edge === 'start' ? 'wordStart' : 'wordEnd'}`, { word: w.text })}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                projectStore.getState().beginGesture('history.retimeWord');
                dragging.current = true;
                setDrag({ index: w.index, edge });
              }}
              onPointerMove={(e) => {
                if (drag && e.currentTarget.hasPointerCapture(e.pointerId)) move(drag, e.clientX);
              }}
              onPointerUp={endDrag}
              onLostPointerCapture={endDrag}
            />
          ))}
        </div>
      ))}
      <div className="playhead" style={{ left: x(time) }} />
    </div>
  );
}
