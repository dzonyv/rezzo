import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CachedFolder, StorageClear, StorageUsage } from '../../../shared/api.ts';
import { formatBytes, localeOf } from '../format.ts';
import { forgetThumbnails } from './ClipThumb.tsx';
import { askConfirm, notify } from './prompts.ts';

const total = (items: readonly { bytes: number }[]) => items.reduce((sum, i) => sum + i.bytes, 0);

/** Everything Rezzo keeps on the disk: the cache plus the downloaded tools. */
export const usageBytes = (usage: StorageUsage): number => total(usage.cache) + total(usage.tools);

/**
 * How much disk the cache and downloaded tools take, by video and by tool,
 * and deleting them: one at a time, or the whole cache. Whatever a running
 * job uses stays (main says so).
 */
export function StorageDialog({ open, onClose, onChange }: { open: boolean; onClose: () => void; onChange: (usage: StorageUsage) => void }) {
  const { t, i18n } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [deleting, setDeleting] = useState(false);
  const locale = localeOf(i18n.language);
  const size = (bytes: number) => formatBytes(bytes, locale);

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
    if (!open) return;
    // Measured again each time it opens; until then the last numbers stand.
    let current = true;
    window.rezzo.invoke('storage:usage').then(
      (u) => {
        if (!current) return;
        setUsage(u);
        onChange(u);
      },
      (e: unknown) => current && notify('error', t('storage.failed', { detail: String(e) })),
    );
    return () => {
      current = false;
    };
    // onChange and t don't change what's measured.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const clear = async (what: StorageClear) => {
    setDeleting(true);
    try {
      const result = await window.rezzo.invoke('storage:clear', what);
      // Cards would show pictures that are gone; they're asked for again.
      forgetThumbnails();
      setUsage(result.usage);
      onChange(result.usage);
      if (result.skipped > 0) notify('info', t('storage.skipped'));
    } catch (e) {
      notify('error', t('storage.failed', { detail: String(e) }));
    } finally {
      setDeleting(false);
    }
  };

  const clearAll = async () => {
    if (!usage) return;
    const free = usage.cache.filter((c) => !c.busy);
    const yes = await askConfirm({
      title: t('storage.confirmTitle'),
      body: t('storage.confirmBody', { size: size(total(free)) }),
      confirm: t('storage.confirm'),
      cancel: t('common.cancel'),
    });
    if (yes) await clear({ cache: free.map((c) => c.fingerprint), tools: [] });
  };

  const when = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: 'medium' });
  const label = (c: CachedFolder) =>
    c.kind === 'episode'
      ? { name: c.name, meta: t('storage.episodeMeta', { when: when(c.openedAt!) }) }
      : c.kind === 'layer'
        ? { name: c.name, meta: t('storage.layerMeta') }
        : { name: t('storage.other'), meta: t('storage.otherMeta') };

  const row = (key: string, name: string | null, meta: string, bytes: number, busy: boolean, onDelete: () => void) => (
    <li key={key}>
      <span className="text">
        <span className="name">{name}</span>
        <span className="meta">{meta}</span>
      </span>
      <span className="size">{size(bytes)}</span>
      {busy ? (
        <span className="busy">{t('storage.busy')}</span>
      ) : (
        <button type="button" disabled={deleting} onClick={onDelete}>
          {t('storage.delete')}
        </button>
      )}
    </li>
  );

  return (
    <dialog
      ref={dialog}
      className="modal storage"
      aria-labelledby="storage-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2 id="storage-title">{t('storage.title')}</h2>
      {usage === null ? (
        <p role="status">{t('storage.measuring')}</p>
      ) : (
        <>
          <div className="total">
            <strong>{size(usageBytes(usage))}</strong>
            <span className="meta" title={usage.folder}>
              {usage.folder}
            </span>
          </div>
          <p>{t('storage.intro')}</p>
          {usage.cache.length === 0 && usage.tools.length === 0 && <p className="dim">{t('storage.empty')}</p>}
          {usage.cache.length > 0 && (
            <section aria-label={t('storage.videos')}>
              <h3>{t('storage.videos')}</h3>
              <ul>
                {usage.cache.map((c) => {
                  const { name, meta } = label(c);
                  return row(c.fingerprint, name, meta, c.bytes, c.busy, () => void clear({ cache: [c.fingerprint], tools: [] }));
                })}
              </ul>
            </section>
          )}
          {usage.tools.length > 0 && (
            <section aria-label={t('storage.tools')}>
              <h3>{t('storage.tools')}</h3>
              <ul>
                {usage.tools.map((tool) =>
                  row(tool.id, tool.name, t(tool.known ? 'storage.toolMeta' : 'storage.oldTool'), tool.bytes, tool.busy, () => void clear({ cache: [], tools: [tool.id] })),
                )}
              </ul>
            </section>
          )}
        </>
      )}
      <div className="buttons">
        <button type="button" className="link" onClick={() => void window.rezzo.invoke('storage:reveal')}>
          {t('storage.reveal')}
        </button>
        <span className="spacer" />
        {usage && usage.cache.some((c) => !c.busy) && (
          <button type="button" disabled={deleting} onClick={() => void clearAll()}>
            {t('storage.clearAll', { size: size(total(usage.cache.filter((c) => !c.busy))) })}
          </button>
        )}
        <button type="button" className="primary" autoFocus onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </dialog>
  );
}
