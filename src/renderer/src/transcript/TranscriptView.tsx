import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Segment, Transcript } from '../../../shared/project.ts';
import { formatDuration } from '../format.ts';
import { playbackStore, seek, usePlayback } from '../player/playback.ts';
import { buildIndex, search, type Match } from './search.ts';
import { flatten, wordAt, type FlatTranscript } from './words.ts';

/** Words Whisper was least sure about get a subtle underline: the ones worth checking. */
const UNSURE = 0.4;
/** After the user scrolls by hand, playback stops pulling the view along for a while. */
const MANUAL_SCROLL_MS = 4000;

export function TranscriptView({ transcript }: { transcript: Transcript }) {
  const { t } = useTranslation();
  const flat = useMemo(() => flatten(transcript.segments), [transcript]);
  const index = useMemo(() => buildIndex(flat.words), [flat]);

  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const matches = useMemo(() => search(index, deferredQuery), [index, deferredQuery]);
  // The cursor belongs to one result list; a new search starts at its first match.
  const [cursor, setCursor] = useState({ matches, current: 0 });
  const current = cursor.matches === matches ? cursor.current : 0;
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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const step = (by: number) => {
    if (matches.length > 0) setCursor({ matches, current: (current + by + matches.length) % matches.length });
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
        onClick={(e) => {
          const target = (e.target as HTMLElement).closest<HTMLElement>('[data-time]');
          if (target) seek(Number(target.dataset['time']));
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
              />
            </div>
          ))}
        </div>
      </div>
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

const SegmentRow = memo(function SegmentRow({
  segment,
  firstWord,
  active,
  hits,
}: {
  segment: Segment;
  firstWord: number;
  active: number;
  hits: Hits | undefined;
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
            <span key={index} className={wordClass(index === active, hits, index, w.p < UNSURE)} data-time={w.start}>
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

function wordClass(active: boolean, hits: Hits | undefined, index: number, unsure: boolean): string {
  const classes = ['w'];
  if (active) classes.push('active');
  if (hits?.any.has(index)) classes.push('hit');
  if (hits?.current.has(index)) classes.push('current');
  if (unsure) classes.push('unsure');
  return classes.join(' ');
}
