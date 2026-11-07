import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DOCK_SIZES, type ClipDock as Dock } from '../../../shared/settings.ts';
import { setSettings } from '../settings.ts';

/** The dock can't be dragged shorter than this, or so tall that the picture has less than PICTURE_PX. */
const MIN_PX = 160;
const PICTURE_PX = 240;

/**
 * The bottom of the clip editor, across the whole window: the timeline and
 * the tools for it. Drag the handle on top to make it taller or shorter, or
 * pick a size: Compact (just the rows), Normal, or Full timeline, where the
 * picture moves into a narrow column beside it. The size is remembered.
 */
export function ClipDock({ dock, tools, children }: { dock: Dock; tools: ReactNode; children: ReactNode }) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; height: number; moved: boolean } | null>(null);
  // Follows the pointer while dragging, and is saved to the settings when the drag ends.
  // Kept after that, so the dock doesn't jump back while the settings catch up.
  const [dragged, setDragged] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const height = dragged ?? dock.height;

  const maxHeight = () => (box.current?.closest('.workspace')?.clientHeight ?? window.innerHeight) - PICTURE_PX;
  const clamp = (h: number) => Math.round(Math.max(MIN_PX, Math.min(h, maxHeight())));

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || dock.size === 'full') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const current = box.current!.getBoundingClientRect().height;
    drag.current = { y: e.clientY, height: current, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientY - d.y) < 2) return;
    d.moved = true;
    setDragging(true);
    setDragged(clamp(d.height - (e.clientY - d.y)));
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    if (!d.moved) return;
    // Dragging a compact dock makes it a normal one of that height.
    void setSettings({ clipDock: { size: 'normal', height } });
  };

  return (
    <div ref={box} className={`clip-dock ${dock.size}`} style={dock.size === 'normal' || dragging ? { height } : undefined}>
      <div
        className="dock-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('timeline.resize')}
        title={t('timeline.resize')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onLostPointerCapture={onPointerUp}
      />
      <div className="dock-body">
        <div className="dock-tools">
          {tools}
        <div className="segmented dock-sizes" role="group" aria-label={t('timeline.size')}>
          {DOCK_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              aria-pressed={dock.size === size}
              title={t(`timeline.sizes.${size}Help`)}
              onClick={() => {
                setDragged(null);
                void setSettings({ clipDock: { ...dock, height, size } });
              }}
            >
              {t(`timeline.sizes.${size}`)}
            </button>
          ))}
        </div>
        </div>
        {children}
      </div>
    </div>
  );
}
