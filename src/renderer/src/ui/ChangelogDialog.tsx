import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CHANGELOG } from '../../../shared/changelog.ts';
import { UI_LANGUAGES, type UiLanguage } from '../../../shared/settings.ts';

/** What changed in each version, newest first, in the interface language. */
export function ChangelogDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const language: UiLanguage = UI_LANGUAGES.find((l) => l === i18n.language) ?? 'en';

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="modal changelog"
      aria-labelledby="changelog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2 id="changelog-title">{t('home.changelog')}</h2>
      <div className="releases">
        {CHANGELOG.map((release) => (
          <section key={release.version}>
            <h3>{release.version}</h3>
            <ul>
              {release.changes[language].map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="buttons">
        <button type="button" className="primary" autoFocus onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </dialog>
  );
}
