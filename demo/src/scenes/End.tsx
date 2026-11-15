import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion';
import { pop } from '../anim';
import type { Copy } from '../copy';
import { C, FONT_DISPLAY, FONT_UI } from '../theme';

/** 25–30 s: the icon, the name and where to get it. */
export function End({ copy }: { copy: Copy }) {
  const frame = useCurrentFrame();
  const icon = pop(frame, 2, 10);
  const name = pop(frame, 10);
  const tagline = pop(frame, 20);
  const link = pop(frame, 30);
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, alignItems: 'center' }}>
      <Img
        src={staticFile('icon.svg')}
        style={{ position: 'absolute', top: 480, width: 320, height: 320, transform: `scale(${icon}) rotate(${(1 - icon) * -20}deg)` }}
      />
      <div
        style={{
          position: 'absolute',
          top: 870,
          fontFamily: FONT_DISPLAY,
          fontWeight: 800,
          fontSize: 150,
          letterSpacing: 6,
          color: C.text,
          opacity: name,
          transform: `translateY(${(1 - name) * 50}px)`,
        }}
      >
        REZZO
      </div>
      <div
        style={{
          position: 'absolute',
          top: 1090,
          fontFamily: FONT_UI,
          fontWeight: 600,
          fontSize: 60,
          color: C.accent,
          opacity: tagline,
          transform: `translateY(${(1 - tagline) * 30}px)`,
        }}
      >
        {copy.tagline}
      </div>
      <div
        style={{
          position: 'absolute',
          top: 1240,
          padding: '22px 44px',
          borderRadius: 999,
          backgroundColor: C.surface2,
          border: `2px solid ${C.border}`,
          fontFamily: FONT_UI,
          fontWeight: 500,
          fontSize: 44,
          color: C.text,
          opacity: link,
          transform: `scale(${0.9 + 0.1 * link})`,
        }}
      >
        github.com/dzonyv/rezzo
      </div>
      <div style={{ position: 'absolute', top: 1380, fontFamily: FONT_UI, fontSize: 34, color: C.dim, opacity: link }}>{copy.platform}</div>
      <div
        style={{
          position: 'absolute',
          bottom: 60,
          left: 60,
          right: 60,
          textAlign: 'center',
          fontFamily: FONT_UI,
          fontSize: 24,
          color: C.dim,
          opacity: link,
        }}
      >
        {copy.credit}
      </div>
    </AbsoluteFill>
  );
}
