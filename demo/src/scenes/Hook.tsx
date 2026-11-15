import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame } from 'remotion';
import { ease, pop } from '../anim';
import type { Copy } from '../copy';
import { C, FONT_DISPLAY } from '../theme';

/** 0–2.5 s: a wide film frame folds into a 9:16 one, under the promise. */
export function Hook({ copy }: { copy: Copy }) {
  const frame = useCurrentFrame();
  const fold = pop(frame, 18, 18);
  const width = 940 + (420 - 940) * fold;
  const height = 393 + (746 - 393) * fold;
  const exit = ease(frame, 62, 75);
  const first = pop(frame, 4);
  const second = pop(frame, 30);

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, opacity: 1 - exit, transform: `scale(${1 + exit * 0.15})` }}>
      <div
        style={{
          position: 'absolute',
          left: 540 - width / 2,
          top: 700 - height / 2,
          width,
          height,
          borderRadius: 18 + 18 * fold,
          overflow: 'hidden',
          outline: `8px solid ${C.accent}`,
          outlineOffset: 10,
          opacity: ease(frame, 0, 8),
        }}
      >
        {/* The film from 0:28; footage.mp4 starts at 0:24. */}
        <OffthreadVideo
          src={staticFile('footage.mp4')}
          trimBefore={4 * 30}
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '62% 50%' }}
        />
      </div>
      <div style={{ position: 'absolute', top: 1220, width: '100%', textAlign: 'center', fontFamily: FONT_DISPLAY }}>
        <div style={{ fontSize: 72, fontWeight: 700, color: C.text, opacity: first, transform: `translateY(${(1 - first) * 40}px)` }}>
          {copy.hook[0]}
        </div>
        <div
          style={{
            fontSize: 72,
            fontWeight: 800,
            color: C.accent,
            marginTop: 18,
            opacity: second,
            transform: `translateY(${(1 - second) * 40}px)`,
          }}
        >
          {copy.hook[1]}
        </div>
      </div>
    </AbsoluteFill>
  );
}
