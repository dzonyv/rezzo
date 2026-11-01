import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Replacement } from '../../../shared/replacements.ts';
import { useProject } from '../project/store.ts';
import { applyReplacementList } from '../project/transcript.ts';
import { notify } from './prompts.ts';
import { loadRules, openReplacements, saveRules, useReplacements } from './replacements.ts';

/** Editing the replacement list. Changes are saved when the dialog closes. */
export function ReplacementsDialog() {
  const { t } = useTranslation();
  const open = useReplacements((s) => s.dialogOpen);
  const hasTranscript = useProject((s) => s.project?.transcript != null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [rules, setRules] = useState<Replacement[] | null>(null);

  useEffect(() => {
    const el = dialog.current!;
    if (!open) return;
    el.showModal();
    let current = true;
    void loadRules().then((r) => {
      if (current) setRules(r);
    });
    return () => {
      current = false;
      el.close();
      setRules(null);
    };
  }, [open]);

  const set = (i: number, patch: Partial<Replacement>) => setRules((rs) => rs && rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  /** Saves the list; on failure says why and returns null, leaving the dialog open. */
  const save = async () => {
    if (!rules) return null;
    try {
      return await saveRules(rules);
    } catch {
      notify('error', t('replacements.saveFailed'));
      return null;
    }
  };

  const close = async () => {
    if (rules && !(await save())) return;
    openReplacements(false);
  };

  const apply = async () => {
    // The rules as saved (trimmed), so this matches what new transcripts get.
    const saved = await save();
    if (!saved) return;
    const changed = applyReplacementList(saved);
    notify('info', t('replacements.applied', { count: changed }));
  };

  return (
    <dialog
      ref={dialog}
      className="modal replacements-dialog"
      aria-label={t('replacements.title')}
      onCancel={(e) => {
        e.preventDefault();
        void close();
      }}
    >
      <h2>{t('replacements.title')}</h2>
      <p>{t('replacements.help')}</p>
      {rules && (
        <div className="replacement-rows">
          {rules.map((r, i) => (
            <div key={i} className="replacement-row">
              <input aria-label={t('replacements.from')} placeholder={t('replacements.from')} value={r.from} onChange={(e) => set(i, { from: e.target.value })} />
              <span aria-hidden="true">→</span>
              <input aria-label={t('replacements.to')} placeholder={t('replacements.to')} value={r.to} onChange={(e) => set(i, { to: e.target.value })} />
              <button
                type="button"
                className="icon"
                aria-label={t('replacements.remove')}
                title={t('replacements.remove')}
                onClick={() => setRules(rules.filter((_, j) => j !== i))}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setRules([...rules, { from: '', to: '' }])}>
            {t('replacements.add')}
          </button>
        </div>
      )}
      <div className="buttons">
        <button type="button" disabled={!rules || !hasTranscript} onClick={() => void apply()}>
          {t('replacements.apply')}
        </button>
        <button type="button" className="primary" onClick={() => void close()}>
          {t('replacements.done')}
        </button>
      </div>
    </dialog>
  );
}
