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
  /** Called when a copy couldn't be written, once until one is written again. */
  onFailing(detail: string): void;
}

/**
 * Starts writing recovery copies; returns a function that stops it. A copy
 * that couldn't be written is tried again on the next round, without waiting
 * for another edit.
 */
export function startRecoveryCopies({ unsaved, write, onFailing }: RecoveryCopies, everyMs = AUTOSAVE_MS): () => void {
  let written: Project | null = null;
  let writing = false;
  let failing = false;
  const timer = setInterval(() => {
    const now = unsaved();
    if (!now || now.project === written || writing) return;
    writing = true;
    write(now.project, now.filePath)
      .then(() => {
        written = now.project;
        failing = false;
      })
      .catch((e: unknown) => {
        if (!failing) onFailing(e instanceof Error ? e.message : String(e));
        failing = true;
      })
      .finally(() => (writing = false));
  }, everyMs);
  return () => clearInterval(timer);
}
