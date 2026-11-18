/**
 * The episode's voices, told apart in the background once there is a
 * transcript, and again when the transcript, its words or the number of
 * people change. The result comes from the cache, not the project.
 */
import { isDraft, original, type Draft } from 'immer';
import { useMemo } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { VoicesResult } from '../../../shared/api.ts';
import { clipName } from '../../../shared/clips.ts';
import { isEkavian, speechChanges, textAfter, writeSpeech, type EkavianTable, type Speech } from '../../../shared/ekavian.ts';
import type { Clip, Project, Segment, Word } from '../../../shared/project.ts';
import {
  heardVoices,
  voiceAt,
  type EpisodeVoices,
  type HeardVoices,
  type SpeakerCount,
  type SpeakerPick,
  type Span,
  type VoiceEdit,
} from '../../../shared/voices.ts';
import type { VoicesProgress } from '../../../shared/worker-api.ts';
import { ekavianNow, loadEkavian } from '../ekavian/table.ts';
import { projectStore, useProject, type EditLabel } from './store.ts';

export interface VoicesState {
  /** The project the rest is about; null with no project or no transcript. */
  projectId: string | null;
  status: 'idle' | 'running' | 'ready' | 'failed';
  progress: VoicesProgress | null;
  voices: EpisodeVoices | null;
  /** Why it failed, for the error message. */
  detail: string | null;
}

const idle: VoicesState = { projectId: null, status: 'idle', progress: null, voices: null, detail: null };
export const voicesStore = createStore<VoicesState>()(() => idle);

export function useVoices<T>(select: (s: VoicesState) => T): T {
  return useStore(voicesStore, select);
}

window.rezzo.on('voices:progress', ({ projectId, progress }) => {
  const s = voicesStore.getState();
  if (s.projectId === projectId && s.status === 'running') voicesStore.setState({ progress });
});

/** Each run gets a number, so a late answer to an older run is ignored. */
let runs = 0;

async function run(project: Project): Promise<void> {
  if (!project.source || !project.transcript) return;
  const id = ++runs;
  voicesStore.setState({ projectId: project.id, status: 'running', progress: null, detail: null });
  let result: VoicesResult;
  try {
    result = await window.rezzo.invoke('voices:start', {
      projectId: project.id,
      source: project.source,
      transcript: project.transcript,
      count: project.voices.count,
    });
  } catch (e) {
    result = { ok: false, error: 'failed', detail: e instanceof Error ? e.message : String(e) };
  }
  if (id !== runs) return;
  if (result.ok) {
    voicesStore.setState({ status: 'ready', progress: null, voices: result.voices });
    void matchWordsToVoices();
  } else if (result.error === 'failed') voicesStore.setState({ status: 'failed', progress: null, detail: result.detail });
  else voicesStore.setState({ status: 'idle', progress: null });
}

/** Tries again after a failure. */
export function retryVoices(): void {
  const project = projectStore.getState().project;
  if (project) void run(project);
}

/** Edited words wait this long, so a burst of edits makes one run. */
const EDIT_SETTLE_MS = 2000;

/** What the result depends on, besides the words themselves. */
const inputsOf = (p: Project | null) => (p?.source && p.transcript ? `${p.id}|${p.source.fingerprint}|${p.transcript.createdAt}|${p.voices.count}` : null);

let settle: ReturnType<typeof setTimeout> | undefined;

projectStore.subscribe((s, prev) => {
  // Ready before anyone makes a choice that needs it.
  if (s.project?.transcript) void loadEkavian().catch(() => undefined);
  const now = inputsOf(s.project);
  const before = inputsOf(prev.project);
  const wordsEdited = now !== null && now === before && s.project?.transcript?.segments !== prev.project?.transcript?.segments;
  if (now === before && !wordsEdited) return;
  clearTimeout(settle);
  if (now === null || !s.project) {
    if (voicesStore.getState().status === 'running') void window.rezzo.invoke('voices:cancel');
    runs++;
    voicesStore.setState(idle);
    return;
  }
  const project = s.project;
  if (wordsEdited) {
    // The worker only redoes the pieces the edit changed; the old result shows until then.
    settle = setTimeout(() => void run(projectStore.getState().project ?? project), EDIT_SETTLE_MS);
    return;
  }
  // A different project shows nothing from the last one while it runs.
  if (project.id !== voicesStore.getState().projectId) voicesStore.setState({ ...idle, projectId: project.id });
  void run(project);
});

export function setSpeakerCount(count: SpeakerCount): void {
  projectStore.getState().edit('history.speakerCount', (d) => void (d.voices.count = count));
}

/** The voices with the user's corrections on them; null until there's a result. */
export function useHeardVoices(): HeardVoices | null {
  const found = useVoices((s) => s.voices);
  const edits = useProject((s) => s.project?.voices.edits);
  return useMemo(() => (found ? heardVoices(found, edits ?? []) : null), [found, edits]);
}

/** Whether a word is to be ekavian: its voice's choice, or the project's for a word nobody's voice covers. */
export function ekavianChooser(speech: Speech, heard: HeardVoices | null): (word: Word) => boolean {
  if (!heard) return () => isEkavian(null, speech);
  const own = new Map(heard.voices.map((v) => [v.id, v.ekavian]));
  return (word) => {
    const voice = voiceAt(heard.turns, (word.start + word.end) / 2);
    return isEkavian(voice === null ? null : own.get(voice), speech);
  };
}

/** The words inside a clip's range. */
const wordsIn = (segments: readonly Segment[], clip: Pick<Clip, 'start' | 'end'>): Word[] =>
  segments.flatMap((s) => s.words.filter((w) => w.start >= clip.start && w.end <= clip.end));

/**
 * Writes the transcript's words the way the project's choices in `draft`
 * now say. A clip still called after its words, as it was named when it
 * was made, gets the new words in its name too.
 */
function rewriteWords(draft: Draft<Project>, table: EkavianTable): void {
  if (!draft.transcript) return;
  // Read from the transcript as it was, so only the words that change are drafted.
  const plain: readonly Segment[] = isDraft(draft.transcript) ? original(draft.transcript)!.segments : draft.transcript.segments;
  const found = voicesStore.getState().voices;
  const ekavianFor = ekavianChooser(draft.speech, found ? heardVoices(found, draft.voices.edits) : null);
  if (speechChanges(plain, ekavianFor, table) === 0) return;
  for (const clip of draft.clips) {
    const words = wordsIn(plain, clip);
    if (words.length === 0 || clip.name !== clipName(words)) continue;
    clip.name = clipName(words.map((w) => ({ text: textAfter(w, ekavianFor(w), table) })));
  }
  writeSpeech(draft.transcript.segments, ekavianFor, table, plain);
}

/** The word list for an edit, or null if it can't load, so the edit still happens. */
async function tableForEdit(): Promise<EkavianTable | null> {
  try {
    return await loadEkavian();
  } catch (e) {
    console.warn('The ekavian word list could not be loaded:', e);
    return null;
  }
}

/**
 * Makes an edit to the voices. Any of them but a name can change whose a
 * word is, or whether it's ekavian, so the words are rewritten in the same
 * undo step. Once the list has loaded (it starts with the transcript), the
 * edit happens at once, before anything else the user does.
 */
async function editVoices(label: EditLabel, recipe: (draft: Draft<Project>) => void, rewrite = true): Promise<void> {
  const table = rewrite ? (ekavianNow() ?? (await tableForEdit())) : null;
  projectStore.getState().edit(label, (d) => {
    recipe(d);
    if (table) rewriteWords(d, table);
  });
}

/**
 * After the voices are worked out again, their turns and numbers can move:
 * the words are matched to whoever now says them, as an undo step of its
 * own, and only if any word changes.
 */
async function matchWordsToVoices(): Promise<void> {
  const table = await tableForEdit();
  const project = projectStore.getState().project;
  const found = voicesStore.getState().voices;
  if (!table || !project?.transcript || !found) return;
  const ekavianFor = ekavianChooser(project.speech, heardVoices(found, project.voices.edits));
  if (speechChanges(project.transcript.segments, ekavianFor, table) === 0) return;
  projectStore.getState().edit('history.matchVoices', (d) => rewriteWords(d, table));
}

const addVoiceEdit = (label: EditLabel, edit: VoiceEdit, rewrite = true) => editVoices(label, (d) => void d.voices.edits.push(edit), rewrite);

/** Names the voice talking at `at`; an empty name takes it away. */
export const nameVoice = (at: number, name: string) => addVoiceEdit('history.nameVoice', { kind: 'name', at, name }, false);

/** The voice at `at` is the same person as the voice at `into`. */
export const mergeVoice = (at: number, into: number) => addVoiceEdit('history.mergeVoices', { kind: 'merge', at, into });

/** The turn is someone else's: the voice at `as`, a new voice, or nobody's. */
export const correctTurn = ({ start, end }: Span, as: number | 'new' | null) => addVoiceEdit('history.correctTurn', { kind: 'turn', start, end, as });

export const splitTurn = (at: number) => addVoiceEdit('history.splitTurn', { kind: 'split', at });

/** Ekavian or as spoken, for the voice talking at `at`. */
export const setVoiceSpeech = (at: number, ekavian: boolean) => addVoiceEdit('history.voiceSpeech', { kind: 'speech', at, ekavian });

/** Ekavian or as spoken, for everyone whose voice has no choice of its own. */
export const setSpeech = (speech: Speech) => editVoices('history.speech', (d) => void (d.speech = speech));

/** Back to the voices as they were found, with nobody said to be anywhere, in any clip. */
export const forgetVoiceEdits = () =>
  editVoices('history.forgetVoiceEdits', (d) => {
    d.voices.edits = [];
    d.voices.picks = [];
  });

/** Puts `next` in the place of the pick `old`; either can be null. */
export function pickSpeaker(old: SpeakerPick | null, next: SpeakerPick | null): void {
  projectStore.getState().edit('history.pickSpeaker', (d) => {
    if (old) d.voices.picks = d.voices.picks.filter((p) => p.t !== old.t);
    if (next) d.voices.picks.push(next);
  });
}
