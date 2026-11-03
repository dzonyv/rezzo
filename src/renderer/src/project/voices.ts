/**
 * The episode's voices, told apart in the background once there is a
 * transcript, and again when the transcript, its words or the number of
 * people change. The result comes from the cache, not the project.
 */
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { VoicesResult } from '../../../shared/api.ts';
import type { Project } from '../../../shared/project.ts';
import type { EpisodeVoices, SpeakerCount } from '../../../shared/voices.ts';
import type { VoicesProgress } from '../../../shared/worker-api.ts';
import { projectStore } from './store.ts';

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

/** Seconds each voice talks, by voice number. */
export function talkTimes(voices: EpisodeVoices): number[] {
  const times = new Array<number>(voices.voices).fill(0);
  for (const t of voices.turns) times[t.voice] = (times[t.voice] ?? 0) + t.end - t.start;
  return times;
}
