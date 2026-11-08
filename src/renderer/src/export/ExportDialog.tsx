import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { fileName, formatDuration } from '../format.ts';
import { ClipThumb } from '../ui/ClipThumb.tsx';
import type { ThumbnailSize } from '../../../shared/worker-api.ts';
import { cancelExport, dismissExport, isExporting, useExport, type ExportState } from './state.ts';

/** The picture fills a 9:16 frame about 600 px tall: the card's would be blurry. */
const PICTURE: ThumbnailSize = 'large';

/**
 * The running export over the whole window: the clip's picture with a
 * curtain that draws back as the frames are made, a big percentage and the
 * time left. Then the result: the yellow slab when it worked, the same
 * layout without it when it didn't.
 */
export function ExportDialog() {
  const { t, i18n } = useTranslation();
  const state = useExport((s) => s);
  const dialog = useRef<HTMLDialogElement>(null);
  const visible = state.status !== 'idle' && state.status !== 'choosing';
  const running = state.status === 'preparing' || state.status === 'rendering' || state.status === 'finishing' ? state : null;

  useEffect(() => {
    if (visible && !dialog.current?.open) dialog.current?.showModal();
    if (!visible && dialog.current?.open) dialog.current.close();
  }, [visible]);

  const seconds = (s: number) => s.toLocaleString(i18n.language, { maximumFractionDigits: 1 });

  return (
    <dialog
      ref={dialog}
      className="export-dialog"
      aria-labelledby="export-title"
      onCancel={(e) => {
        // Escape closes a result, but doesn't stop a running export.
        e.preventDefault();
        if (!isExporting()) dismissExport();
      }}
    >
      {visible && (
        <div className="export-stage">
          <div className="export-picture">
            <ClipThumb clip={state.clip} source={state.source} size={PICTURE} />
            {running && <div className="curtain" style={{ left: `${drawn(running) * 100}%` }} />}
          </div>

          <section className="export-side">
            {running && <Running state={running} />}

            {state.status === 'done' && (
              <div className="export-done">
                <div className="slab lower" />
                <div className="slab" />
                <div className="content">
                  <h2 id="export-title">{t('export.done')}</h2>
                  <p>{t('export.doneDetail', { file: fileName(state.path), seconds: seconds(state.seconds), encoder: t(`export.encoders.${state.encoder}`) })}</p>
                  <div className="buttons">
                    <button type="button" className="on-slab" onClick={() => void window.rezzo.invoke('export:open')}>
                      {t('export.open')}
                    </button>
                    <button type="button" className="on-slab outline" onClick={() => void window.rezzo.invoke('export:reveal')}>
                      {t('export.reveal')}
                    </button>
                    <button type="button" className="on-slab outline" autoFocus onClick={dismissExport}>
                      {t('export.close')}
                    </button>
                  </div>
                </div>
              </div>
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
          </section>
        </div>
      )}
    </dialog>
  );
}

type Running = Extract<ExportState, { status: 'preparing' | 'rendering' | 'finishing' }>;

/** How much of the clip has been drawn, 0..1: nothing while the working file is made. */
function drawn(state: Running): number {
  if (state.status === 'rendering') return state.done / state.total;
  return state.status === 'finishing' ? 1 : 0;
}

/** The title, the big percentage, the bar, what it's doing, and Cancel. */
function Running({ state }: { state: Running }) {
  const { t } = useTranslation();
  // Making the working file comes first, with its own percentage in a quieter colour.
  const preparing = state.status === 'preparing';
  const fraction = state.status === 'preparing' ? state.fraction : drawn(state);
  const percent = Math.round(fraction * 100);
  const status =
    state.status === 'rendering'
      ? state.left === null
        ? t('export.rendering')
        : t('export.left', { left: formatDuration(Math.ceil(state.left)) })
      : state.status === 'finishing'
        ? t('export.finishing')
        : t('export.preparing');
  return (
    <>
      <h2 id="export-title">{t('export.title', { name: state.clipName })}</h2>
      <div className={preparing ? 'export-percent preparing' : 'export-percent'} aria-hidden="true">
        {percent}%
      </div>
      {state.status === 'rendering' ? (
        <progress aria-label={status} max={state.total} value={state.done} />
      ) : (
        <progress aria-label={status} max={1} value={fraction} />
      )}
      <p className="export-status">{status}</p>
      <div className="buttons">
        <button type="button" onClick={() => void cancelExport()}>
          {t('export.cancel')}
        </button>
      </div>
    </>
  );
}
