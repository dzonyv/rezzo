import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion';
import { ease, pop } from '../anim';
import type { Copy } from '../copy';
import { C, FONT_DISPLAY } from '../theme';

/** When each feature line comes in, in frames from the start of the scene. */
export const FEATURE_AT = (i: number) => 10 + i * 22;

/** 20–25 s: what else it does, one line at a time over the clip editor. */
export function Features({ copy }: { copy: Copy }) {
  const frame = useCurrentFrame();
  const enter = ease(frame, 0, 12);
  const exit = ease(frame, 136, 150);
  const drift = frame * 0.6;
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, opacity: enter * (1 - exit) }}>
      <Img
        src={staticFile('clip.png')}
        style={{
          position: 'absolute',
          height: 1920,
          left: -900 - drift,
          top: 0,
          maxWidth: 'none',
          opacity: 0.22,
          filter: 'blur(6px)',
        }}
      />
      <AbsoluteFill style={{ background: `linear-gradient(180deg, ${C.bg}00 0%, ${C.bg}cc 50%, ${C.bg}00 100%)` }} />
      <div style={{ position: 'absolute', top: 560, left: 90, right: 60, display: 'flex', flexDirection: 'column', gap: 64 }}>
        {copy.features.map((feature, i) => {
          const p = pop(frame, FEATURE_AT(i), 13);
          return (
            <div
              key={feature}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 36,
                opacity: Math.min(1, p * 1.5),
                transform: `translateX(${(1 - p) * -120}px)`,
              }}
            >
              <svg width={84} height={84} viewBox="0 0 84 84" style={{ flexShrink: 0 }}>
                <rect width="84" height="84" rx="24" fill={C.accent} />
                <path d="M24 43 L37 56 L61 30" fill="none" stroke={C.accentText} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 60, lineHeight: 1.15, color: C.text }}>{feature}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
