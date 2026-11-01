import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fitsInClip, rangeForWords } from '../../../shared/clips.ts';
import { MAX_CLIP_SECONDS, type Clip, type Segment, type Source, type Transcript } from '../../../shared/project.ts';
import { useOpenClip, useOpenClipId } from '../clip/state.ts';
import { formatDuration } from '../format.ts';
import { seek } from '../player/playback.ts';
import { createClip, setClipWords } from '../project/clips.ts';
import { ruleFor } from '../../../shared/replacements.ts';
import { wordsOfText } from '../../../shared/transcript-edit.ts';
import { useProject } from '../project/store.ts';
import { confirmWord, editWord, joinWords } from '../project/transcript.ts';
import { isTypingTarget } from '../ui/focus.ts';
import { acceptOffer, offerRule, openReplacements, useReplacements } from '../ui/replacements.ts';
import { buildIndex, search, type Match } from './search.ts';
import { clearSelection, enterWord, pressWord, release, selectedRange, useSelection } from './selection.ts';
import { startEditing, stopEditing, useEditing, type Finish } from './editing.ts';
import { listeningStore, playAround, seekPaused, useListening } from './listening.ts';
import { WordEditor } from './WordEditor.tsx';
import { flatOf, nextUnsure, refOf, UNSURE, wordAt, type FlatTranscript, type FlatWord } from './words.ts';

/** After the user scrolls by hand, playback stops pulling the view along for a while. */
const MANUAL_SCROLL_MS = 4000;

export function TranscriptView({ transcript, source }: { transcript: Transcript; source: Source }) {
  const { t } = useTranslation();
  const flat = flatOf(transcript.segments);
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

  const active = useListening((s) => wordAt(flat.words, s.time));
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
    if (activeSegment < 0 || !listeningStore.getState().playing) return;
    if (Date.now() - manualScrollAt.current < MANUAL_SCROLL_MS) return;
    virtualizer.scrollToIndex(activeSegment, { align: 'auto' });
  }, [activeSegment, virtualizer]);

  const editing = useEditing();
  const editingWord = editing !== null ? flat.words[editing] : undefined;
  // Opening the editor on a word shows that word in the player, paused.
  const shownForEdit = useRef<number | null>(null);
  useEffect(() => {
    if (!editingWord) {
      shownForEdit.current = null;
      return;
    }
    if (shownForEdit.current === editingWord.index) return;
    shownForEdit.current = editingWord.index;
    seekPaused(editingWord.start);
    virtualizer.scrollToIndex(editingWord.segment, { align: 'auto' });
  }, [editingWord, virtualizer]);

  /** Applies a correction to word `index`, then opens the editor where it says to go next. */
  const finish = (index: number, f: Finish) => {
    stopEditing();
    if (f.kind === 'cancel') return;
    const at = refOf(flat, index);
    const word = flat.words[index]!;
    let count = 1;
    if (wordsOfText(f.text).join(' ') !== word.text) {
      // How many words now stand where the edited one was; the words after it move by count - 1.
      count = editWord(at, f.text);
      const rule = count > 0 ? ruleFor(word.text, f.text) : null;
      if (rule) offerRule(rule);
    } else if (word.p < UNSURE) {
      // Left as it was: checked and right, so it stops counting as unsure.
      confirmWord(at);
    }
    const length = flat.words.length + count - 1;
    let next = -1;
    if (f.kind === 'next') next = index + count;
    else if (f.kind === 'previous') next = index - 1;
    else if (f.kind === 'nextUnsure') next = ((i) => (i < 0 ? -1 : i + count - 1))(nextUnsure(flat.words, index + 1, 1));
    else if (f.kind === 'previousUnsure') next = nextUnsure(flat.words, index - 1, -1);
    // An emptied word was deleted, and joining now would glue the words either side of it
    // together; the editor just moves on to the neighbour instead.
    else if (f.kind === 'joinPrevious') {
      if (count > 0 && index > 0) joinWords(refOf(flat, index - 1));
      next = index - 1;
    } else if (f.kind === 'joinNext') {
      if (count > 0) joinWords({ ...at, word: at.word + count - 1 });
      next = index + Math.max(count - 1, 0);
    }
    // The editor may come back at the same number (a deleted word's neighbour), and that word still needs showing.
    shownForEdit.current = null;
    if (next >= 0 && next < length) startEditing(next);
  };

  // Bring the current search result into view.
  const currentMatch = matches[current];
  useEffect(() => {
    if (currentMatch) virtualizer.scrollToIndex(flat.words[currentMatch.first]!.segment, { align: 'center' });
  }, [currentMatch, flat, virtualizer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { words } = flatRef.current;
      const here = wordAt(words, listeningStore.getState().time);
      if (e.key === 'F2' && !isTypingTarget(e.target) && words.length > 0) {
        e.preventDefault();
        startEditing(Math.max(here, 0));
      } else if (e.ctrlKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !isTypingTarget(e.target)) {
        // The next word Whisper wasn't sure about, straight into the editor.
        e.preventDefault();
        const by = e.key === 'ArrowDown' ? 1 : -1;
        const unsure = nextUnsure(words, here + by, by);
        if (unsure >= 0) startEditing(unsure);
      } else if (e.ctrlKey && e.key.toLowerCase() === 'f') {
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

  // The key handler is set up once and reads the words through this.
  const flatRef = useRef(flat);
  useEffect(() => {
    flatRef.current = flat;
  }, [flat]);

  // Word numbers belong to one transcript; a selection means nothing in another.
  useEffect(() => clearSelection, [flat]);
  // An edit keeps the editor's own word in step; anything else (undo, a new transcript) closes it.
  const project = useProject((s) => s.project?.id);
  useEffect(() => stopEditing, [project]);

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
        <button type="button" onClick={() => openReplacements(true)} title={t('replacements.buttonHelp')}>
          {t('replacements.button')}
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
        onDoubleClick={(e) => {
          const word = (e.target as HTMLElement).closest<HTMLElement>('[data-word]');
          if (!word) return;
          clearSelection();
          startEditing(Number(word.dataset['word']));
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
                editing={editingWord?.segment === row.index ? editingWord.index : -1}
                onFinish={editingWord?.segment === row.index ? finish : undefined}
              />
            </div>
          ))}
        </div>
      </div>

      <ReplaceOffer />

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

/** After a correction that a rule could make: offers to add that rule to the replacement list. */
function ReplaceOffer() {
  const { t } = useTranslation();
  const offer = useReplacements((s) => s.offer);
  if (!offer) return null;
  return (
    <div className="replace-offer" role="status">
      <span>{t('replacements.offer', { from: offer.from, to: offer.to })}</span>
      <div className="spacer" />
      <button type="button" className="primary" onClick={() => void acceptOffer()}>
        {t('replacements.always')}
      </button>
      <button type="button" onClick={() => offerRule(null)}>
        {t('replacements.notNow')}
      </button>
    </div>
  );
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
  editing,
  onFinish,
}: {
  segment: Segment;
  firstWord: number;
  active: number;
  hits: Hits | undefined;
  selection: { first: number; last: number } | null;
  marks: Uint8Array;
  /** The word being corrected, if it's in this segment; -1 otherwise. */
  editing: number;
  onFinish: ((index: number, f: Finish) => void) | undefined;
}) {
  return (
    <>
      <span className="segment-time" data-time={segment.start}>
        {formatDuration(segment.start)}
      </span>
      <p className="segment-text">
        {segment.words.map((w, i) => {
          const index = firstWord + i;
          if (index === editing && onFinish) {
            return (
              <span key={index} className="w editing">
                <WordEditor text={w.text} onFinish={(f) => onFinish(index, f)} onListen={() => playAround(w.start)} />{' '}
              </span>
            );
          }
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
