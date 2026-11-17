/**
 * Closing a menu or popup that floats over the editor: a pointer down
 * anywhere outside it, or Escape. Escape is caught before the editor's own
 * keys see it, so closing the menu doesn't also deselect a layer.
 */
import { useEffect, useEffectEvent, type RefObject } from 'react';

/** How a menu was closed: by Escape (focus goes back to what opened it) or by pressing elsewhere. */
export type DismissedBy = 'escape' | 'outside';

/** Calls `onClose` while `active`, when the pointer goes down outside `ref` or Escape is pressed. */
export function useDismiss(ref: RefObject<HTMLElement | null>, onClose: (by: DismissedBy) => void, active = true): void {
  // The caller's handler can change on every render (the timeline draws on every frame); the listeners stay.
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (!active) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close('outside');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      close('escape');
    };
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [ref, active]);
}
