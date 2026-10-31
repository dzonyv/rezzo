/**
 * What the menu-level commands do: new, open, save, close. Each one checks
 * for unsaved work where it would otherwise be lost, and only after the
 * user has picked a file, so cancelling a dialog changes nothing.
 */
import i18n from 'i18next';
import { newProject, type Project } from '../../../shared/project.ts';
import { baseName } from '../format.ts';
import { cancelExport, isExporting } from '../export/state.ts';
import { askConfirm, askUnsaved, notify } from '../ui/prompts.ts';
import { isDirty, projectStore } from './store.ts';
import { cancelTranscription } from './transcription.ts';

const api = () => window.rezzo;

/**
 * Wraps a command so a failure nobody planned for (a crashed worker, a
 * missing tool) shows up as a notice instead of disappearing.
 */
function command<A extends unknown[], R>(fn: (...args: A) => Promise<R>, fallback: R): (...args: A) => Promise<R> {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      notify('error', i18n.t('errors.unexpected', { detail: e instanceof Error ? e.message : String(e) }));
      return fallback;
    }
  };
}

/**
 * Stops a running export if the user agrees, makes sure unsaved work is
 * saved or deliberately dropped, then stops anything still running for the
 * project. Returns false if the user cancelled.
 */
export const settleUnsaved = command(async (): Promise<boolean> => {
  if (isExporting()) {
    const stop = await askConfirm({
      title: i18n.t('export.running.title'),
      body: i18n.t('export.running.body'),
      confirm: i18n.t('export.running.stop'),
      cancel: i18n.t('export.running.keep'),
    });
    if (!stop) return false;
    await cancelExport();
  }
  const state = projectStore.getState();
  if (state.project && isDirty(state)) {
    const answer = await askUnsaved(state.project.name);
    if (answer === 'cancel') return false;
    if (answer === 'save' && !(await save(false))) return false;
    if (answer === 'discard') await api().invoke('project:discard-recovery', state.project.id);
  }
  cancelTranscription();
  return true;
}, false);

/** Starts a project from a video: `file`, or one the user picks. */
export const createProject = command(async (file: string | null = null): Promise<void> => {
  const chosen = file ?? (await api().invoke('episode:choose'));
  if (!chosen) return;
  const result = await api().invoke('episode:import', chosen);
  if (!result.ok) {
    notify('error', i18n.t(`errors.import.${result.error}`, { path: chosen }));
    return;
  }
  if (!(await settleUnsaved())) return;
  projectStore.getState().load({ ...newProject(baseName(chosen)), source: result.source }, null);
}, undefined);

/** Points the project at its source video after the file has moved. */
export const locateSource = command(async (): Promise<boolean> => {
  const source = projectStore.getState().project?.source;
  if (!source) return false;
  const result = await api().invoke('episode:locate', source);
  if (!result) return false;
  if (!result.ok) {
    notify(
      'error',
      result.error === 'different-file'
        ? i18n.t('errors.locate.different')
        : i18n.t(`errors.import.${result.error}`, { path: source.path }),
    );
    return false;
  }
  // Moving the file isn't an edit to undo.
  projectStore.getState().replace((d) => void (d.source = result.source));
  return true;
}, false);

/** Opens `path`, or one the user picks. */
export const openProject = command(async (path: string | null = null): Promise<void> => {
  const chosen = path ?? (await api().invoke('project:choose'));
  if (!chosen) return;
  const result = await api().invoke('project:open', chosen);
  if (!result.ok) {
    notify('error', i18n.t(`errors.open.${result.error}`, { path: result.path }));
    return;
  }
  if (!(await settleUnsaved())) return;
  projectStore.getState().load(result.project, result.path);
}, undefined);

/** Continues with work rescued from a crash. It stays unsaved until saved. */
export const restoreProject = command(async (project: Project, filePath: string | null): Promise<void> => {
  if (!(await settleUnsaved())) return;
  projectStore.getState().load(project, null);
  if (filePath) projectStore.setState({ filePath });
}, undefined);

/** Saves; `saveAs` (or a project never saved) asks where. Returns true when saved. */
export const save = command(async (saveAs: boolean): Promise<boolean> => {
  // A field that applies its value when left (the word being corrected) does so before the save.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  const { project, filePath } = projectStore.getState();
  if (!project) return false;
  projectStore.getState().endGesture();
  const result = await api().invoke('project:save', project, saveAs ? null : filePath);
  if (!result) return false;
  if (!result.ok) {
    notify('error', i18n.t('errors.save', { detail: result.detail }));
    return false;
  }
  projectStore.getState().markSaved(project, result.path);
  return true;
}, false);

export const closeProject = command(async (): Promise<void> => {
  if (!(await settleUnsaved())) return;
  projectStore.getState().close();
}, undefined);

/** The window's close button: settle unsaved work, then let the window go. */
export const closeWindow = command(async (): Promise<void> => {
  if (!(await settleUnsaved())) return;
  await api().invoke('app:close');
}, undefined);
