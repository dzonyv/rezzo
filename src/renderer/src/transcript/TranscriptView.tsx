import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fitsInClip, rangeForWords } from '../../../shared/clips.ts';
import { MAX_CLIP_SECONDS, type Clip, type Segment, type Source, type Transcript } from '../../../shared/project.ts';
import { useOpenClip, useOpenClipId } from '../clip/state.ts';
import { formatDuration } from '../format.ts';
import { playbackStore, seek, usePlayback } from '../player/playback.ts';
import { createClip, setClipWords } from '../project/clips.ts';
import { useProject } from '../project/store.ts';
import { isTypingTarget } from '../ui/focus.ts';
import { buildIndex, search, type Match } from './search.ts';
import { clearSelection, enterWord, pressWord, release, selectedRange, useSelection } from './selection.ts';
import { flatten, wordAt, type FlatTranscript, type FlatWord } from './words.ts';

/** Words Whisper was least sure about get a subtle underline: the ones worth checking. */
const UNSURE = 0.4;
/** After the user scrolls by hand, playback stops pulling the view along for a while. */
const MANUAL_SCROLL_MS = 4000;

export function TranscriptView({ transcript, source }: { transcript: Transcript; source: Source }) {
  const { t } = useTranslation();
  const flat = useMemo(() => flatten(transcript.segments), [transcript]);
  const index = useMemo(() => buildIndex(flat.words), [flat]);

  const clips = useProject((s) => s.project?.clips);
  const openClipId = useOpenClipId();
  const marks = useMemo(() => clipMarks(flat.words, clips ?? [], openClipId), [flat, clips, openClipId]);
  const anchor = useSelection((s) => s.anchor);
  const focus = useSelection((s) => s.focus);
  const dragging = useSelection((s) => s.dragging);
  const selection = useMemo(() => selectedRange({ anchor, focus, dragging: false, moved: false }), [anchor, focus]);
  const pressedAt = useRef(0);

  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const matches = useMemo(() => search(index, deferredQuery), [index, deferredQuery]);
  // The cursor belongs to what's typed; a new search starts at its first match.
  // Keyed by the typed text, not the results, so Enter pressed while the
  // results are still catching up with the typing isn't lost when they arrive.
  const [cursor, setCursor] = useState({ query, current: 0 });
  const current = cursor.query === query && cursor.current < matches.length ? cursor.current : 0;
  const hits = useMemo(() => hitsBySegment(flat, matches, current), [flat, matches, current]);

  const active = usePlayback((s) => wordAt(flat.words, s.time));
  const activeSegment = active >= 0 ? flat.words[active]!.segment : -1;

  const scroller = useRef<HTMLDivElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const manualScrollAt = useRef(0);
  const virtualizer = useVirtualizer({
    count: transcript.segments.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 64,
    overscan: 8,
  });

  // Follow the speech while playing, unless the user is looking elsewhere.
  useEffect(() => {
    if (activeSegment < 0 || !playbackStore.getState().playing) return;
    if (Date.now() - manualScrollAt.current < MANUAL_SCROLL_MS) return;
    virtualizer.scrollToIndex(activeSegment, { align: 'auto' });
  }, [activeSegment, virtualizer]);

  // Bring the current search result into view.
  const currentMatch = matches[current];
  useEffect(() => {
    if (currentMatch) virtualizer.scrollToIndex(flat.words[currentMatch.first]!.segment, { align: 'center' });
  }, [currentMatch, flat, virtualizer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchBox.current?.focus();
        searchBox.current?.select();
      } else if (e.key === 'Escape' && !isTypingTarget(e.target)) {
        clearSelection();
      }
    };
    // A press can end anywhere, also outside the transcript.
    const onUp = () => {
      if (release() === 'click') seek(pressedAt.current);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  // Word numbers belong to one transcript; a selection means nothing in another.
  useEffect(() => clearSelection, [flat]);

  const step = (by: number) => {
    if (matches.length > 0) setCursor({ query, current: (current + by + matches.length) % matches.length });
  };

  return (
    <section className="transcript">
      <div className="transcript-search">
        <input
          ref={searchBox}
          type="search"
          aria-label={t('transcript.search')}
          placeholder={t('transcript.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              step(e.shiftKey ? -1 : 1);
            } else if (e.key === 'Escape') {
              setQuery('');
            }
          }}
        />
        {deferredQuery.trim() !== '' && (
          <span className="count">
            {matches.length > 0 ? t('transcript.matches', { current: current + 1, total: matches.length }) : t('transcript.noMatches')}
          </span>
        )}
        <button
          type="button"
          className="icon"
          disabled={matches.length === 0}
          aria-label={t('transcript.previous')}
          title={t('transcript.previous')}
          onClick={() => step(-1)}
        >
          <Chevron up />
        </button>
        <button
          type="button"
          className="icon"
          disabled={matches.length === 0}
          aria-label={t('transcript.next')}
          title={t('transcript.next')}
          onClick={() => step(1)}
        >
          <Chevron />
        </button>
      </div>

      <div
        ref={scroller}
        className="transcript-scroll"
        onWheel={() => (manualScrollAt.current = Date.now())}
        onPointerDown={(e) => {
          const word = (e.target as HTMLElement).closest<HTMLElement>('[data-word]');
          if (!word || e.button !== 0) return;
          // Keeps the browser from selecting text while we select words.
          e.preventDefault();
          pressedAt.current = Number(word.dataset['time']);
          pressWord(Number(word.dataset['word']), e.shiftKey);
        }}
        onPointerOver={(e) => {
          const word = (e.target as HTMLElement).closest<HTMLElement>('[data-word]');
          if (word) enterWord(Number(word.dataset['word']));
        }}
        onClick={(e) => {
          const time = (e.target as HTMLElement).closest<HTMLElement>('.segment-time');
          if (time) seek(Number(time.dataset['time']));
        }}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((row) => (
            <div
              key={row.key}
              data-index={row.index}
              ref={virtualizer.measureElement}
              className="segment-row"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              <SegmentRow
                segment={transcript.segments[row.index]!}
                firstWord={flat.segmentStart[row.index]!}
                active={row.index === activeSegment ? active : -1}
                hits={hits.get(row.index)}
                selection={selection}
                marks={marks}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Floats over the text and waits for the press to end, so nothing moves under the pointer. */}
      {selection && !dragging && (
        <SelectionBar words={flat.words.slice(selection.first, selection.last + 1)} source={source} />
      )}
    </section>
  );
}

interface Hits {
  /** Words inside any match. */
  any: Set<number>;
  /** Words inside the current match. */
  current: Set<number>;
}

function hitsBySegment(flat: FlatTranscript, matches: Match[], current: number): Map<number, Hits> {
  const out = new Map<number, Hits>();
  matches.forEach((m, i) => {
    for (let w = m.first; w <= m.last; w++) {
      const segment = flat.words[w]!.segment;
      let h = out.get(segment);
      if (!h) out.set(segment, (h = { any: new Set(), current: new Set() }));
      h.any.add(w);
      if (i === current) h.current.add(w);
    }
  });
  return out;
}

/** Per word: 0 outside any clip, 1 inside a clip, 2 inside the open clip. */
function clipMarks(words: readonly FlatWord[], clips: readonly Clip[], openClipId: string | null): Uint8Array {
  const marks = new Uint8Array(words.length);
  for (const clip of clips) {
    const mark = clip.id === openClipId ? 2 : 1;
    for (const w of words) {
      if (w.start >= clip.start - 1e-6 && w.end <= clip.end + 1e-6) marks[w.index] = Math.max(marks[w.index]!, mark);
    }
  }
  return marks;
}

/** How long the selected words run, and buttons that turn them into a clip. */
function SelectionBar({ words, source }: { words: FlatWord[]; source: Source }) {
  const { t } = useTranslation();
  const open = useOpenClip();
  const range = rangeForWords(words, source);
  const fits = fitsInClip(range);
  const done = (fn: () => void) => () => {
    fn();
    clearSelection();
  };
  return (
    <div className="selection-bar">
      <span>{t('clips.selected', { count: words.length, duration: formatDuration(range.end - range.start) })}</span>
      {!fits && <span className="warning">{t('clips.tooLong', { minutes: MAX_CLIP_SECONDS / 60 })}</span>}
      <div className="spacer" />
      {open && (
        <button type="button" disabled={!fits} onClick={done(() => setClipWords(open.id, words))}>
          {t('clips.useForOpen', { name: open.name })}
        </button>
      )}
      <button type="button" className="primary" disabled={!fits} onClick={done(() => createClip(words))}>
        {t('clips.create')}
      </button>
      <button type="button" onClick={clearSelection}>
        {t('clips.clearSelection')}
      </button>
    </div>
  );
}

const SegmentRow = memo(function SegmentRow({
  segment,
  firstWord,
  active,
  hits,
  selection,
  marks,
}: {
  segment: Segment;
  firstWord: number;
  active: number;
  hits: Hits | undefined;
  selection: { first: number; last: number } | null;
  marks: Uint8Array;
}) {
  return (
    <>
      <span className="segment-time" data-time={segment.start}>
        {formatDuration(segment.start)}
      </span>
      <p className="segment-text">
        {segment.words.map((w, i) => {
          const index = firstWord + i;
          return (
            <span
              key={index}
              className={wordClass(index === active, hits, index, w.p < UNSURE, selection, marks[index]!)}
              data-time={w.start}
              data-word={index}
            >
              {w.text}{' '}
            </span>
          );
        })}
      </p>
    </>
  );
});

function Chevron({ up = false }: { up?: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d={up ? 'M2 8l4-4 4 4' : 'M2 4l4 4 4-4'} fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function wordClass(
  active: boolean,
  hits: Hits | undefined,
  index: number,
  unsure: boolean,
  selection: { first: number; last: number } | null,
  mark: number,
): string {
  const classes = ['w'];
  if (mark === 1) classes.push('in-clip');
  if (mark === 2) classes.push('in-open-clip');
  if (selection && index >= selection.first && index <= selection.last) classes.push('selected');
  if (active) classes.push('active');
  if (hits?.any.has(index)) classes.push('hit');
  if (hits?.current.has(index)) classes.push('current');
  if (unsure) classes.push('unsure');
  return classes.join(' ');
}
