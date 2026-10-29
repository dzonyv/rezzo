/**
 * Things that follow the open project around: the window title, keyboard
 * shortcuts, recovery copies of unsaved work, and the window's close button.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { isTypingTarget } from '../ui/focus.ts';
import { closeWindow, createProject, openProject, save } from './actions.ts';
import { isDirty, projectStore, useProject } from './store.ts';

const AUTOSAVE_MS = 30_000;

export function useProjectChrome(): void {
  const { t } = useTranslation();
  const name = useProject((s) => s.project?.name);
  const dirty = useProject(isDirty);

  useEffect(() => {
    document.title = name === undefined ? t('app.name') : `${dirty ? '• ' : ''}${name} — ${t('app.name')}`;
  }, [name, dirty, t]);

  useEffect(() => window.rezzo.on('app:close-requested', () => void closeWindow()), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const store = projectStore.getState();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (key === 's') run(() => void save(e.shiftKey));
      else if (key === 'o') run(() => void openProject());
      else if (key === 'n') run(() => void createProject());
      // Typing in a field keeps the field's own undo.
      else if (isTypingTarget(e.target)) return;
      else if (key === 'z' && !e.shiftKey) run(() => store.undo());
      else if (key === 'y' || (key === 'z' && e.shiftKey)) run(() => store.redo());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    let written: unknown = null;
    const timer = setInterval(() => {
      const state = projectStore.getState();
      if (!state.project || !isDirty(state) || state.project === written) return;
      written = state.project;
      void window.rezzo.invoke('project:autosave', state.project, state.filePath);
    }, AUTOSAVE_MS);
    return () => clearInterval(timer);
  }, []);
}
