import type { CSSProperties } from 'react';
import { AbsoluteFill, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { ease, pop, track } from '../anim';
import { captionPages } from '../captions';
import type { Copy } from '../copy';
import { C, FONT_CAPTION, FONT_UI, FPS } from '../theme';

/** footage.mp4 starts at 0:24 in the film; this scene starts at 0:25. */
const FOOTAGE_START = 24;
const SCENE_START = 25;
const SRC = { w: 1280, h: 534 };

type Layout = 'full' | 'split' | 'follow';
/** Which layout shows from which frame of the scene. */
const LAYOUTS: { layout: Layout; from: number; to: number }[] = [
  { layout: 'full', from: 0, to: 75 },
  { layout: 'split', from: 75, to: 210 },
  { layout: 'follow', from: 210, to: 390 },
];
const FADE = 8;

/** Where the two people's heads are, by film time: [seconds, x] and their crop centre heights. */
const TOM_X: [number, number][] = [[25, 470], [27, 505], [30, 500], [31.5, 440], [34, 400], [40, 400]];
const CELIA_X: [number, number][] = [[25, 830], [30, 840], [31.5, 790], [34, 745], [40, 730]];
/** Follow: Celia talks until 34.3, then Tom. */
const FOLLOW_X: [number, number][] = [[32, 770], [33.5, 750], [34.3, 745], [34.9, 410], [40, 400]];

const filmTime = (sceneFrame: number) => SCENE_START + sceneFrame / FPS;

/** The video cropped to a rectangle of the film (centre cx, cy and height h), filling a w×h box. */
function Crop({ cx, cy, h, box, from }: { cx: number; cy: number; h: number; box: { w: number; h: number }; from: number }) {
  const scale = box.h / h;
  const halfW = (box.w / scale) / 2;
  const x = Math.min(Math.max(cx, halfW), SRC.w - halfW);
  const y = Math.min(Math.max(cy, h / 2), SRC.h - h / 2);
  return (
    <div style={{ position: 'relative', width: box.w, height: box.h, overflow: 'hidden' }}>
      <OffthreadVideo
        src={staticFile('footage.mp4')}
        trimBefore={Math.round((SCENE_START - FOOTAGE_START) * FPS) + from}
        muted
        style={{
          position: 'absolute',
          width: SRC.w * scale,
          height: SRC.h * scale,
          left: box.w / 2 - x * scale,
          top: box.h / 2 - y * scale,
          maxWidth: 'none',
        }}
      />
    </div>
  );
}

function LayoutView({ layout, from }: { layout: Layout; from: number }) {
  const local = useCurrentFrame();
  const t = filmTime(from + local);
  const video = (style: CSSProperties) => (
    <OffthreadVideo
      src={staticFile('footage.mp4')}
      trimBefore={Math.round((SCENE_START - FOOTAGE_START) * FPS) + from}
      muted
      style={style}
    />
  );
  if (layout === 'full') {
    return (
      <AbsoluteFill style={{ backgroundColor: '#000' }}>
        {video({ position: 'absolute', height: 1920, width: 1920 * (SRC.w / SRC.h), left: -800, filter: 'blur(40px) brightness(0.55)', maxWidth: 'none' })}
        {video({ position: 'absolute', width: 1080, top: 960 - 225, height: 450 })}
      </AbsoluteFill>
    );
  }
  if (layout === 'split') {
    const box = { w: 1080, h: 960 };
    return (
      <AbsoluteFill style={{ backgroundColor: '#000' }}>
        <Crop cx={track(t, TOM_X)} cy={190} h={380} box={box} from={from} />
        <Crop cx={track(t, CELIA_X)} cy={200} h={380} box={box} from={from} />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Crop cx={track(t, FOLLOW_X)} cy={250} h={500} box={{ w: 1080, h: 1920 }} from={from} />
    </AbsoluteFill>
  );
}

/** The app's segmented control for layouts, with the active one lit. */
function LayoutSwitch({ copy, active, frame }: { copy: Copy; active: Layout; frame: number }) {
  const order: Layout[] = ['follow', 'split', 'full'];
  return (
    <div
      style={{
        position: 'absolute',
        top: 110,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        opacity: pop(frame, 6),
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: 10,
          borderRadius: 999,
          backgroundColor: 'rgba(29, 27, 22, 0.88)',
          border: `2px solid ${C.border}`,
          fontFamily: FONT_UI,
          fontWeight: 600,
          fontSize: 38,
        }}
      >
        {order.map((layout) => (
          <div
            key={layout}
            style={{
              padding: '16px 34px',
              borderRadius: 999,
              backgroundColor: layout === active ? C.accent : 'transparent',
              color: layout === active ? C.accentText : C.text,
            }}
          >
            {copy.layouts[layout]}
          </div>
        ))}
      </div>
    </div>
  );
}

const PAGES = captionPages();

const toFrame = (seconds: number) => Math.round((seconds - SCENE_START) * FPS);

/**
 * A caption style the app can make: Montserrat ExtraBold in capitals, words
 * revealed as they're spoken with a pop, the spoken word dark on a yellow box.
 */
function Captions({ frame }: { frame: number }) {
  const t = filmTime(frame);
  const page = PAGES.find((p) => t >= p.start && t < p.end);
  if (!page) return null;
  const pageEnd = toFrame(page.end);
  // The page sinks and fades over its last few frames, unless the next one follows right away.
  const nextStartsNow = PAGES.some((p) => p !== page && Math.abs(p.start - page.end) < 0.05);
  const leave = nextStartsNow ? 0 : ease(frame, pageEnd - 5, pageEnd);
  return (
    <div
      style={{
        position: 'absolute',
        top: 1210,
        left: 40,
        right: 40,
        textAlign: 'center',
        fontFamily: FONT_CAPTION,
        fontWeight: 800,
        fontSize: 76,
        lineHeight: 1.22,
        letterSpacing: -1,
        textTransform: 'uppercase',
        opacity: 1 - leave,
        transform: `translateY(${leave * 20}px)`,
        filter: 'drop-shadow(0 8px 18px rgba(0, 0, 0, 0.55))',
      }}
    >
      {page.lines.map((line, i) => (
        <div key={i}>
          {line.map((word, j) => {
            const since = frame - toFrame(word.start);
            const shown = since >= 0;
            const spoken = t >= word.start && t < word.end;
            const enter = pop(since, 0, 11);
            // The box springs open when the word starts and is gone once the next word starts.
            const box = spoken ? pop(since, 0, 13) : 0;
            return (
              <span
                key={j}
                style={{
                  position: 'relative',
                  display: 'inline-block',
                  margin: '4px 6px',
                  padding: '2px 12px',
                  opacity: shown ? Math.min(1, enter * 3) : 0,
                  transform: `translateY(${(1 - enter) * 26}px) scale(${0.7 + 0.3 * Math.min(enter, 1)}) rotate(${-1.5 * box}deg)`,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: 18,
                    backgroundColor: C.accent,
                    transform: `scale(${box})`,
                  }}
                />
                <span
                  style={{
                    position: 'relative',
                    // Dark text only once the box is big enough to sit behind it.
                    color: box > 0.6 ? C.accentText : '#fff',
                    WebkitTextStroke: box > 0.6 ? '0' : '12px #000',
                    paintOrder: 'stroke fill',
                  }}
                >
                  {word.text}
                </span>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** 7–20 s: the clip itself, through all three layouts, with captions. */
export function Footage({ copy }: { copy: Copy }) {
  const frame = useCurrentFrame();
  const active = LAYOUTS.find((l) => frame >= l.from && frame < l.to)?.layout ?? 'follow';
  const exit = ease(frame, 378, 390);
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, opacity: 1 - exit }}>
      {LAYOUTS.map(({ layout, from, to }) => {
        const start = Math.max(0, from - FADE);
        return (
          <Sequence key={layout} from={start} durationInFrames={to - start}>
            <AbsoluteFill style={{ opacity: from === 0 ? 1 : ease(frame, from - FADE, from) }}>
              <LayoutView layout={layout} from={start} />
            </AbsoluteFill>
          </Sequence>
        );
      })}
      <LayoutSwitch copy={copy} active={active} frame={frame} />
      <Captions frame={frame} />
      <div
        style={{
          position: 'absolute',
          bottom: 50,
          width: '100%',
          textAlign: 'center',
          fontFamily: FONT_UI,
          fontSize: 24,
          color: 'rgba(246, 242, 231, 0.75)',
          textShadow: '0 1px 4px #000',
        }}
      >
        {copy.credit}
      </div>
    </AbsoluteFill>
  );
}
