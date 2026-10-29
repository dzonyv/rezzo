/**
 * What the menu-level commands do: new, open, save, close. Each one checks
 * for unsaved work first where it would otherwise be lost.
 */
import i18n from 'i18next';
import { newProject, type Project } from '../../../shared/project.ts';
import { baseName } from '../format.ts';
import { askUnsaved, notify } from '../ui/prompts.ts';
import { isDirty, projectStore } from './store.ts';

const api = () => window.rezzo;

/**
 * Makes sure unsaved work is saved or deliberately dropped.
 * Returns false if the user cancelled.
 */
export async function settleUnsaved(): Promise<boolean> {
  const state = projectStore.getState();
  if (!state.project || !isDirty(state)) return true;
  const answer = await askUnsaved(state.project.name);
  if (answer === 'cancel') return false;
  if (answer === 'save') return save(false);
  await api().invoke('project:discard-recovery', state.project.id);
  return true;
}

/** Starts a project from a video: `file`, or one the user picks. */
export async function createProject(file: string | null = null): Promise<void> {
  if (!(await settleUnsaved())) return;
  const chosen = file ?? (await api().invoke('episode:choose'));
  if (!chosen) return;
  const result = await api().invoke('episode:import', chosen);
  if (!result.ok) {
    notify('error', i18n.t(`errors.import.${result.error}`, { path: chosen }));
    return;
  }
  projectStore.getState().load({ ...newProject(baseName(chosen)), source: result.source }, null);
}

/** Points the project at its source video after the file has moved. */
export async function locateSource(): Promise<boolean> {
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
}

/** Opens `path`, or asks for a file when it's null. */
export async function openProject(path: string | null = null): Promise<void> {
  if (!(await settleUnsaved())) return;
  const result = await api().invoke('project:open', path);
  if (!result) return;
  if (!result.ok) {
    notify('error', i18n.t(`errors.open.${result.error}`, { path: result.path }));
    return;
  }
  projectStore.getState().load(result.project, result.path);
}

/** Continues with work rescued from a crash. It stays unsaved until saved. */
export async function restoreProject(project: Project, filePath: string | null): Promise<void> {
  if (!(await settleUnsaved())) return;
  projectStore.getState().load(project, null);
  if (filePath) projectStore.setState({ filePath });
}

/** Saves; `saveAs` (or a project never saved) asks where. Returns true when saved. */
export async function save(saveAs: boolean): Promise<boolean> {
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
}

export async function closeProject(): Promise<void> {
  if (!(await settleUnsaved())) return;
  projectStore.getState().close();
}

/** The window's close button: settle unsaved work, then let the window go. */
export async function closeWindow(): Promise<void> {
  if (!(await settleUnsaved())) return;
  await api().invoke('app:close');
}
