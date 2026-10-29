/**
 * App-wide prompts and notices: the unsaved-changes question and short
 * error messages. Components render whatever is in this store; actions call
 * the functions below and await the answer.
 */
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export type UnsavedAnswer = 'save' | 'discard' | 'cancel';

export interface Notice {
  id: number;
  kind: 'error' | 'info';
  text: string;
}

interface PromptState {
  unsaved: { name: string; answer: (a: UnsavedAnswer) => void } | null;
  notices: Notice[];
}

export const promptStore = createStore<PromptState>()(() => ({ unsaved: null, notices: [] }));

export function usePrompts<T>(select: (s: PromptState) => T): T {
  return useStore(promptStore, select);
}

/** Asks whether to save changes to the project called `name`. */
export function askUnsaved(name: string): Promise<UnsavedAnswer> {
  return new Promise((resolve) => {
    promptStore.setState({
      unsaved: {
        name,
        answer: (a) => {
          promptStore.setState({ unsaved: null });
          resolve(a);
        },
      },
    });
  });
}

let nextNotice = 1;

export function notify(kind: Notice['kind'], text: string): void {
  const notice = { id: nextNotice++, kind, text };
  promptStore.setState((s) => ({ notices: [...s.notices, notice] }));
  if (kind === 'info') setTimeout(() => dismiss(notice.id), 4000);
}

export function dismiss(id: number): void {
  promptStore.setState((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
}
