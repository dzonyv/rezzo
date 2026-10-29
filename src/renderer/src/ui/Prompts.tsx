import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { dismiss, usePrompts } from './prompts.ts';

/** The unsaved-changes dialog and the notice stack, rendered over everything. */
export function Prompts() {
  const { t } = useTranslation();
  const unsaved = usePrompts((s) => s.unsaved);
  const notices = usePrompts((s) => s.notices);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (unsaved && !dialog.current?.open) dialog.current?.showModal();
    if (!unsaved && dialog.current?.open) dialog.current.close();
  }, [unsaved]);

  return (
    <>
      <dialog
        ref={dialog}
        className="modal"
        onCancel={(e) => {
          e.preventDefault();
          unsaved?.answer('cancel');
        }}
      >
        {unsaved && (
          <>
            <h2>{t('unsaved.title', { name: unsaved.name })}</h2>
            <p>{t('unsaved.body')}</p>
            <div className="buttons">
              <button type="button" className="primary" autoFocus onClick={() => unsaved.answer('save')}>
                {t('unsaved.save')}
              </button>
              <button type="button" onClick={() => unsaved.answer('discard')}>
                {t('unsaved.dontSave')}
              </button>
              <button type="button" onClick={() => unsaved.answer('cancel')}>
                {t('unsaved.cancel')}
              </button>
            </div>
          </>
        )}
      </dialog>

      <div className="notices" role="status">
        {notices.map((n) => (
          <div key={n.id} className={`notice ${n.kind}`}>
            <span>{n.text}</span>
            <button type="button" className="link" onClick={() => dismiss(n.id)}>
              {t('common.dismiss')}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
