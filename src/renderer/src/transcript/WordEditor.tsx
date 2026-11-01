import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Finish } from './editing.ts';

/**
 * The text box that stands in for a word while it's corrected. The keys
 * keep both hands on the keyboard: Tab moves on to the next word, Ctrl+↓
 * to the next unsure one, Ctrl+Space plays the word, Backspace at the
 * start or Delete at the end joins it with its neighbour.
 */
export function WordEditor({ text, onFinish, onListen }: { text: string; onFinish: (finish: Finish) => void; onListen: () => void }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  // Set once the editor has handed its result over, so the blur that follows doesn't do it again.
  const finished = useRef(false);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const finish = (f: Finish) => {
    if (finished.current) return;
    finished.current = true;
    onFinish(f);
  };

  return (
    <input
      ref={input}
      className="word-editor"
      aria-label={t('transcript.editWord')}
      title={t('transcript.editHelp')}
      defaultValue={text}
      size={Math.max(text.length + 1, 4)}
      spellCheck={false}
      onInput={(e) => (e.currentTarget.size = Math.max(e.currentTarget.value.length + 1, 4))}
      onBlur={(e) => finish({ kind: 'done', text: e.currentTarget.value })}
      onKeyDown={(e) => {
        const el = e.currentTarget;
        const value = el.value;
        const caretOnly = el.selectionStart === el.selectionEnd;
        let f: Finish | null = null;
        if (e.key === 'Escape') f = { kind: 'cancel' };
        else if (e.key === 'Enter') f = { kind: 'done', text: value };
        else if (e.key === 'Tab') f = { kind: e.shiftKey ? 'previous' : 'next', text: value };
        else if (e.ctrlKey && e.key === 'ArrowDown') f = { kind: 'nextUnsure', text: value };
        else if (e.ctrlKey && e.key === 'ArrowUp') f = { kind: 'previousUnsure', text: value };
        else if (e.key === 'Backspace' && caretOnly && el.selectionStart === 0) f = { kind: 'joinPrevious', text: value };
        else if (e.key === 'Delete' && caretOnly && el.selectionStart === value.length) f = { kind: 'joinNext', text: value };
        else if (e.ctrlKey && e.code === 'Space') {
          e.preventDefault();
          onListen();
          return;
        }
        if (!f) return;
        e.preventDefault();
        // Keeps the transcript's own keys (Escape clears the selection) out of it.
        e.stopPropagation();
        finish(f);
      }}
    />
  );
}
