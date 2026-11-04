/**
 * The episode's voices, told apart in the background once there is a
 * transcript, and again when the transcript, its words or the number of
 * people change. The result comes from the cache, not the project.
 */
import { useMemo } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { VoicesResult } from '../../../shared/api.ts';
import type { Project } from '../../../shared/project.ts';
import { heardVoices, type EpisodeVoices, type HeardVoices, type SpeakerCount, type SpeakerPick, type Span, type VoiceEdit } from '../../../shared/voices.ts';
import type { VoicesProgress } from '../../../shared/worker-api.ts';
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
  if (result.ok) voicesStore.setState({ status: 'ready', progress: null, voices: result.voices });
  else if (result.error === 'failed') voicesStore.setState({ status: 'failed', progress: null, detail: result.detail });
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

function addVoiceEdit(label: EditLabel, edit: VoiceEdit): void {
  projectStore.getState().edit(label, (d) => void d.voices.edits.push(edit));
}

/** Names the voice talking at `at`; an empty name takes it away. */
export const nameVoice = (at: number, name: string) => addVoiceEdit('history.nameVoice', { kind: 'name', at, name });

/** The voice at `at` is the same person as the voice at `into`. */
export const mergeVoice = (at: number, into: number) => addVoiceEdit('history.mergeVoices', { kind: 'merge', at, into });

/** The turn is someone else's: the voice at `as`, a new voice, or nobody's. */
export const correctTurn = ({ start, end }: Span, as: number | 'new' | null) => addVoiceEdit('history.correctTurn', { kind: 'turn', start, end, as });

export const splitTurn = (at: number) => addVoiceEdit('history.splitTurn', { kind: 'split', at });

/** Back to the voices as they were found, with nobody said to be anywhere, in any clip. */
export function forgetVoiceEdits(): void {
  projectStore.getState().edit('history.forgetVoiceEdits', (d) => {
    d.voices.edits = [];
    d.voices.picks = [];
  });
}

/** Puts `next` in the place of the pick `old`; either can be null. */
export function pickSpeaker(old: SpeakerPick | null, next: SpeakerPick | null): void {
  projectStore.getState().edit('history.pickSpeaker', (d) => {
    if (old) d.voices.picks = d.voices.picks.filter((p) => p.t !== old.t);
    if (next) d.voices.picks.push(next);
  });
}
