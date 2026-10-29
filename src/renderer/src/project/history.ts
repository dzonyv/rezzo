/**
 * Undo/redo over an immutable document.
 *
 * Every edit runs through Immer, which hands back the new document plus two
 * patch lists: what changed and how to change it back. Undo applies the
 * second list, redo the first. A gesture (dragging a slider, typing a name)
 * collects all its edits into one undo step.
 */
import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';

enablePatches();

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
}

const LIMIT = 200;

export class History<T> {
  private current: T;
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private gesture: HistoryEntry | undefined;

  constructor(state: T) {
    this.current = state;
  }

  get state(): T {
    return this.current;
  }

  get undoLabel(): string | undefined {
    return this.gesture?.patches.length ? this.gesture.label : this.past.at(-1)?.label;
  }

  get redoLabel(): string | undefined {
    return this.future.at(-1)?.label;
  }

  /** Applies an edit that undo can take back. Edits that change nothing leave no step. */
  edit(label: string, recipe: (draft: Draft<T>) => void): void {
    const [next, patches, inverse] = produceWithPatches(this.current, recipe);
    if (patches.length === 0) return;
    this.current = next as T;
    this.future = [];
    if (this.gesture) {
      this.gesture.patches.push(...patches);
      // Undoing a gesture reverts its last edit first.
      this.gesture.inverse.unshift(...inverse);
    } else {
      this.push({ label, patches, inverse });
    }
  }

  /** Edits until endGesture() become a single undo step. */
  beginGesture(label: string): void {
    this.endGesture();
    this.gesture = { label, patches: [], inverse: [] };
  }

  endGesture(): void {
    const g = this.gesture;
    this.gesture = undefined;
    if (g && g.patches.length > 0) this.push(g);
  }

  undo(): boolean {
    this.endGesture();
    const entry = this.past.pop();
    if (!entry) return false;
    this.current = applyPatches(this.current as object, entry.inverse) as T;
    this.future.push(entry);
    return true;
  }

  redo(): boolean {
    this.endGesture();
    const entry = this.future.pop();
    if (!entry) return false;
    this.current = applyPatches(this.current as object, entry.patches) as T;
    this.past.push(entry);
    return true;
  }

  /**
   * Replaces the document without an undo step and forgets the history:
   * opening a file, or a result from a long job such as transcription.
   */
  reset(state: T): void {
    this.current = state;
    this.past = [];
    this.future = [];
    this.gesture = undefined;
  }

  private push(entry: HistoryEntry): void {
    this.past.push(entry);
    if (this.past.length > LIMIT) this.past.shift();
  }
}
