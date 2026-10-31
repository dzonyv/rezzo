import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { fileName, formatDuration } from '../format.ts';
import { cancelExport, dismissExport, isExporting, useExport } from './state.ts';

/** Progress of the running export, then its result. */
export function ExportDialog() {
  const { t, i18n } = useTranslation();
  const state = useExport((s) => s);
  const dialog = useRef<HTMLDialogElement>(null);
  const visible = state.status !== 'idle' && state.status !== 'choosing';

  useEffect(() => {
    if (visible && !dialog.current?.open) dialog.current?.showModal();
    if (!visible && dialog.current?.open) dialog.current.close();
  }, [visible]);

  const seconds = (s: number) => s.toLocaleString(i18n.language, { maximumFractionDigits: 1 });

  return (
    <dialog
      ref={dialog}
      className="modal export-dialog"
      aria-labelledby="export-title"
      onCancel={(e) => {
        // Escape closes a result, but doesn't stop a running export.
        e.preventDefault();
        if (!isExporting()) dismissExport();
      }}
    >
      {state.status === 'preparing' && (
        <>
          <h2 id="export-title">{t('export.title', { name: state.clipName })}</h2>
          <div className="progress-line">
            <span>{t('export.preparing', { percent: Math.round(state.fraction * 100) })}</span>
            <progress max={1} value={state.fraction} />
          </div>
        </>
      )}
      {state.status === 'rendering' && (
        <>
          <h2 id="export-title">{t('export.title', { name: state.clipName })}</h2>
          <div className="progress-line">
            <span>
              {state.left === null
                ? t('export.rendering', { percent: Math.round((state.done / state.total) * 100) })
                : t('export.renderingLeft', { percent: Math.round((state.done / state.total) * 100), left: formatDuration(Math.ceil(state.left)) })}
            </span>
            <progress max={state.total} value={state.done} />
          </div>
        </>
      )}
      {state.status === 'finishing' && (
        <>
          <h2 id="export-title">{t('export.title', { name: state.clipName })}</h2>
          <div className="progress-line">
            <span>{t('export.finishing')}</span>
            <progress />
          </div>
        </>
      )}
      {isExporting(state) && (
        <div className="buttons">
          <button type="button" onClick={() => void cancelExport()}>
            {t('export.cancel')}
          </button>
        </div>
      )}

      {state.status === 'done' && (
        <>
          <h2 id="export-title">{t('export.done')}</h2>
          <p>
            {t('export.doneDetail', { file: fileName(state.path), seconds: seconds(state.seconds), encoder: t(`export.encoders.${state.encoder}`) })}
          </p>
          <div className="buttons">
            <button type="button" onClick={() => void window.rezzo.invoke('export:reveal')}>
              {t('export.reveal')}
            </button>
            <button type="button" onClick={() => void window.rezzo.invoke('export:open')}>
              {t('export.open')}
            </button>
            <button type="button" className="primary" autoFocus onClick={dismissExport}>
              {t('export.close')}
            </button>
          </div>
        </>
      )}
      {state.status === 'failed' && (
        <>
          <h2 id="export-title">{t('export.failed')}</h2>
          <p className="export-error">{state.detail}</p>
          <div className="buttons">
            <button type="button" className="primary" autoFocus onClick={dismissExport}>
              {t('export.close')}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
