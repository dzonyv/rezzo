import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PLATFORMS } from '../../../shared/safe-zones.ts';
import type { Settings } from '../../../shared/settings.ts';
import { useDismiss } from '../ui/dismiss.ts';

const SAFE_ZONE_CHOICES = ['off', ...PLATFORMS] as const;
type SafeZones = Settings['safeZones'];

interface Props {
  showPeople: boolean;
  onShowPeople: (on: boolean) => void;
  safeZones: SafeZones;
  onSafeZones: (zones: SafeZones) => void;
}

/** Keys that move between the menu's items, and which way. */
const MOVES: Record<string, (at: number, count: number) => number> = {
  ArrowDown: (at, count) => (at + 1) % count,
  ArrowUp: (at, count) => (at - 1 + count) % count,
  Home: () => 0,
  End: (_, count) => count - 1,
};

/**
 * The eye in the preview's corner: what's drawn over the picture to help
 * while editing (the people the analysis found, a platform's safe zones),
 * none of it exported. A dot on the eye says something is on. The menu
 * takes focus when it opens and is worked with the arrow keys, Space and
 * Enter, without those keys reaching the editor (playing, stepping frames).
 */
export function ViewMenu({ showPeople, onShowPeople, safeZones, onSafeZones }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const eye = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const ids = { zones: useId(), help: useId() };
  const on = showPeople || safeZones !== 'off';

  useDismiss(
    root,
    (by) => {
      setOpen(false);
      if (by === 'escape') eye.current?.focus();
    },
    open,
  );

  const items = () => [...(list.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];

  // Opened: the first item has focus, as in any menu.
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    // Space presses the focused button here; the editor would play the clip with it.
    if (e.key === ' ') {
      e.stopPropagation();
      return;
    }
    const move = MOVES[e.key];
    if (!move || !open) return;
    e.preventDefault();
    e.stopPropagation();
    const all = items();
    all[move(all.indexOf(document.activeElement as HTMLElement), all.length)]?.focus();
  };

  return (
    <div ref={root} className={open || on ? 'view-menu shown' : 'view-menu'} onKeyDown={onKeyDown}>
      <button ref={eye} type="button" className="eye" aria-label={t('view.label')} title={t('view.help')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="8" cy="8" r="2.2" fill="currentColor" />
        </svg>
        {on && <span className="dot" />}
      </button>
      {open && (
        <div ref={list} className="view-menu-list" role="menu" aria-label={t('view.label')}>
          <button type="button" role="menuitemcheckbox" aria-checked={showPeople} title={t('analysis.showPeopleHelp')} onClick={() => onShowPeople(!showPeople)}>
            <span className="check" aria-hidden="true" />
            {t('analysis.showPeople')}
          </button>
          <div role="group" aria-labelledby={ids.zones} aria-describedby={ids.help}>
            <h4 id={ids.zones}>{t('safeZones.label')}</h4>
            {SAFE_ZONE_CHOICES.map((p) => (
              <button key={p} type="button" role="menuitemradio" aria-checked={safeZones === p} onClick={() => onSafeZones(p)}>
                <span className="check" aria-hidden="true" />
                {t(`safeZones.platforms.${p}`)}
              </button>
            ))}
            <p id={ids.help} className="dim">
              {t('safeZones.help')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
