import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion';
import { ease, pop } from '../anim';
import type { Copy } from '../copy';
import { C, FONT_DISPLAY, FONT_UI } from '../theme';

/** Where things are in docs/screenshots/episode.png (1424×861). */
const SHOT = { w: 1424, h: 861 };
/** Two transcript lines, as [x, y, width, height] around their words. */
const LINES: [number, number, number, number][] = [
  [521, 158, 366, 26],
  [521, 206, 572, 26],
];
const CARD = { w: 1040, h: 820, top: 560 };

/** 2.5–7 s: the app's transcript; two sentences get selected. */
export function Transcript({ copy }: { copy: Copy }) {
  const frame = useCurrentFrame();
  const zoom = ease(frame, 0, 42);
  const scale = 0.7 + (1.75 - 0.7) * zoom;
  const focusX = 712 + (807 - 712) * zoom;
  const focusY = 430 + (205 - 430) * zoom;
  const enter = pop(frame, 0, 16);
  const exit = ease(frame, 118, 135);
  const sel1 = ease(frame, 48, 64);
  const sel2 = ease(frame, 64, 88);
  const selected = [sel1, sel2];

  // The cursor rides the end of the selection, in screenshot pixels.
  const cursorX = sel2 > 0 ? LINES[1]![0] + LINES[1]![2] * sel2 : LINES[0]![0] + LINES[0]![2] * sel1;
  const cursorY = sel2 > 0 ? LINES[1]![1] + 20 : LINES[0]![1] + 20;

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, opacity: 1 - exit }}>
      <div
        style={{
          position: 'absolute',
          top: 300,
          width: '100%',
          padding: '0 70px',
          boxSizing: 'border-box',
          textAlign: 'center',
          fontFamily: FONT_DISPLAY,
          fontWeight: 700,
          fontSize: 56,
          lineHeight: 1.2,
          color: C.text,
          opacity: pop(frame, 6),
        }}
      >
        <div>{copy.select[0]}</div>
        <div style={{ color: C.accent }}>{copy.select[1]}</div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: (1080 - CARD.w) / 2,
          top: CARD.top,
          width: CARD.w,
          height: CARD.h,
          borderRadius: 36,
          overflow: 'hidden',
          border: `3px solid ${C.border}`,
          backgroundColor: C.surface,
          transform: `scale(${(0.9 + enter * 0.1) * (1 + exit * 0.2)})`,
          opacity: enter,
        }}
      >
        <div
          style={{
            position: 'absolute',
            width: SHOT.w,
            height: SHOT.h,
            left: CARD.w / 2 - focusX * scale,
            top: CARD.h / 2 - focusY * scale,
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          <Img src={staticFile('episode.png')} style={{ width: SHOT.w, height: SHOT.h }} />
          {LINES.map(([x, y, w, h], i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: x - 3,
                top: y - 2,
                width: (w + 6) * selected[i]!,
                height: h + 4,
                borderRadius: 4,
                backgroundColor: 'rgba(255, 212, 0, 0.38)',
              }}
            />
          ))}
          <svg
            width={22}
            height={30}
            viewBox="0 0 22 30"
            style={{
              position: 'absolute',
              left: cursorX,
              top: cursorY,
              opacity: ease(frame, 36, 44) * (1 - ease(frame, 100, 108)),
            }}
          >
            <path d="M1 1 L1 24 L7 18 L11 28 L15 26 L11 17 L20 17 Z" fill="#fff" stroke="#000" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          top: CARD.top + CARD.h + 70,
          width: '100%',
          textAlign: 'center',
          fontFamily: FONT_UI,
          fontSize: 40,
          fontWeight: 500,
          color: C.dim,
          opacity: pop(frame, 70),
        }}
      >
        {copy.languages}
      </div>
    </AbsoluteFill>
  );
}
