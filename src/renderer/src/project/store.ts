/**
 * The open project, for React. Wraps History in a Zustand store so
 * components re-render when the document or the undo state changes.
 */
import type { Draft } from 'immer';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type en from '../../../shared/locales/en.json';
import type { Project } from '../../../shared/project.ts';
import { History } from './history.ts';

/** Undo step labels are translation keys under "history". */
export type EditLabel = `history.${keyof typeof en.history}`;

export interface ProjectState {
  project: Project | null;
  /** Where the project was last saved or opened from; null until first saved. */
  filePath: string | null;
  /** The document as last saved; anything else means unsaved changes. */
  saved: Project | null;
  undoLabel: EditLabel | undefined;
  redoLabel: EditLabel | undefined;
}

export interface ProjectActions {
  /** Starts working on a project; `filePath` is null for a new, unsaved one. */
  load(project: Project, filePath: string | null): void;
  close(): void;
  edit(label: EditLabel, recipe: (draft: Draft<Project>) => void): void;
  /** A change that can't be undone (e.g. a finished transcription); clears undo. */
  replace(recipe: (draft: Draft<Project>) => void): void;
  beginGesture(label: EditLabel): void;
  endGesture(): void;
  undo(): void;
  redo(): void;
  markSaved(project: Project, filePath: string): void;
}

export type ProjectStore = ReturnType<typeof createProjectStore>;

export function createProjectStore() {
  let history: History<Project> | undefined;

  return createStore<ProjectState & ProjectActions>()((set) => {
    const sync = () =>
      set({
        project: history?.state ?? null,
        undoLabel: history?.undoLabel as EditLabel | undefined,
        redoLabel: history?.redoLabel as EditLabel | undefined,
      });

    return {
      project: null,
      filePath: null,
      saved: null,
      undoLabel: undefined,
      redoLabel: undefined,

      load(project, filePath) {
        history = new History(project);
        set({ filePath, saved: filePath ? project : null });
        sync();
      },
      close() {
        history = undefined;
        set({ filePath: null, saved: null });
        sync();
      },
      edit(label, recipe) {
        history?.edit(label, recipe);
        sync();
      },
      replace(recipe) {
        if (!history) return;
        history.edit('replace', recipe);
        history.reset(history.state);
        sync();
      },
      beginGesture(label) {
        history?.beginGesture(label);
        sync();
      },
      endGesture() {
        history?.endGesture();
        sync();
      },
      undo() {
        history?.undo();
        sync();
      },
      redo() {
        history?.redo();
        sync();
      },
      markSaved(project, filePath) {
        set({ saved: project, filePath });
      },
    };
  });
}

/** The app's one project store. */
export const projectStore = createProjectStore();

export function useProject<T>(select: (state: ProjectState & ProjectActions) => T): T {
  return useStore(projectStore, select);
}

export const isDirty = (s: ProjectState): boolean => s.project !== null && s.project !== s.saved;
