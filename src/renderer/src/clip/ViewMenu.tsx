import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PLATFORMS } from '../../../shared/safe-zones.ts';
import type { Settings } from '../../../shared/settings.ts';

const SAFE_ZONE_CHOICES = ['off', ...PLATFORMS] as const;
type SafeZones = Settings['safeZones'];

interface Props {
  showPeople: boolean;
  onShowPeople: (on: boolean) => void;
  safeZones: SafeZones;
  onSafeZones: (zones: SafeZones) => void;
}

/**
 * The eye in the preview's corner: what's drawn over the picture to help
 * while editing (the people the analysis found, a platform's safe zones),
 * none of it exported. A dot on the eye says something is on.
 */
export function ViewMenu({ showPeople, onShowPeople, safeZones, onSafeZones }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const on = showPeople || safeZones !== 'off';

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    // Escape closes the menu only, not the selected layer or anything else the editor does with it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div ref={root} className={open || on ? 'view-menu shown' : 'view-menu'}>
      <button type="button" className="eye" aria-label={t('view.label')} title={t('view.help')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="8" cy="8" r="2.2" fill="currentColor" />
        </svg>
        {on && <span className="dot" />}
      </button>
      {open && (
        <div className="view-menu-list" role="menu" aria-label={t('view.label')}>
          <button type="button" role="menuitemcheckbox" aria-checked={showPeople} title={t('analysis.showPeopleHelp')} onClick={() => onShowPeople(!showPeople)}>
            <span className="check" aria-hidden="true" />
            {t('analysis.showPeople')}
          </button>
          <h4>{t('safeZones.label')}</h4>
          {SAFE_ZONE_CHOICES.map((p) => (
            <button key={p} type="button" role="menuitemradio" aria-checked={safeZones === p} onClick={() => onSafeZones(p)}>
              <span className="check" aria-hidden="true" />
              {t(`safeZones.platforms.${p}`)}
            </button>
          ))}
          <p className="dim">{t('safeZones.help')}</p>
        </div>
      )}
    </div>
  );
}
