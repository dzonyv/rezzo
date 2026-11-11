/**
 * Recovery copies: while the open project has unsaved changes, a copy of it
 * is written every so often, so a crash doesn't lose the work.
 */
import type { Project } from '../../../shared/project.ts';

export const AUTOSAVE_MS = 30_000;

export interface RecoveryCopies {
  /** The project to copy and where it was last saved, or null when there is nothing unsaved. */
  unsaved(): { project: Project; filePath: string | null } | null;
  write(project: Project, filePath: string | null): Promise<unknown>;
  /** Removes a project's copy. */
  discard(projectId: string): Promise<unknown>;
  /** Called when a project's copy couldn't be written, once until one is written again. */
  onFailing(detail: string): void;
}

/**
 * Starts writing recovery copies; returns a function that stops it. A copy
 * that couldn't be written is tried again on the next round, without waiting
 * for another edit.
 */
export function startRecoveryCopies({ unsaved, write, discard, onFailing }: RecoveryCopies, everyMs = AUTOSAVE_MS): () => void {
  let written: Project | null = null;
  let writing = false;
  /** The project whose user has been told its copies fail. */
  let toldAbout: string | null = null;
  const timer = setInterval(() => {
    const now = unsaved();
    if (!now || now.project === written || writing) return;
    const { id } = now.project;
    writing = true;
    write(now.project, now.filePath)
      .then(() => {
        written = now.project;
        if (toldAbout === id) toldAbout = null;
        // Saved or closed while the copy was being written: the copy came after its clean-up, and would be offered as lost work.
        if (unsaved()?.project.id !== id) return discard(id);
      })
      .catch((e: unknown) => {
        if (toldAbout !== id) onFailing(e instanceof Error ? e.message : String(e));
        toldAbout = id;
      })
      .finally(() => (writing = false));
  }, everyMs);
  return () => clearInterval(timer);
}
