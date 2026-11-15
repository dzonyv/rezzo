import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import { COPY, type Lang } from './copy';
import { End } from './scenes/End';
import { FEATURE_AT, Features } from './scenes/Features';
import { Footage } from './scenes/Footage';
import { Hook } from './scenes/Hook';
import { Transcript } from './scenes/Transcript';
import { C, loadFonts } from './theme';

/** Scene start frames at 30 fps; the whole promo is 900 frames, 30 seconds. */
const S = { hook: 0, transcript: 75, footage: 210, features: 600, end: 750, total: 900 };
export const DURATION = S.total;

/** A sound effect from the app's own CC0 library. */
function Sfx({ at, name, volume = 0.5 }: { at: number; name: string; volume?: number }) {
  return (
    <Sequence from={at} durationInFrames={60} layout="none">
      <Audio src={staticFile(`sounds/${name}.ogg`)} volume={volume} />
    </Sequence>
  );
}

export function Promo({ lang }: { lang: Lang }) {
  loadFonts();
  const copy = COPY[lang];
  const scenes = [
    [S.hook, S.transcript, <Hook copy={copy} />],
    [S.transcript, S.footage, <Transcript copy={copy} />],
    [S.footage, S.features, <Footage copy={copy} />],
    [S.features, S.end, <Features copy={copy} />],
    [S.end, S.total, <End copy={copy} />],
  ] as const;
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      {scenes.map(([from, to, scene]) => (
        <Sequence key={from} from={from} durationInFrames={to - from}>
          {scene}
        </Sequence>
      ))}
      <Sfx at={S.hook + 16} name="swish" volume={0.35} />
      <Sfx at={S.transcript - 6} name="whoosh" />
      <Sfx at={S.transcript + 48} name="mouse-click" volume={0.6} />
      <Sfx at={S.footage - 6} name="whoosh" />
      <Sfx at={S.footage + 70} name="swish" volume={0.35} />
      <Sfx at={S.footage + 205} name="swish" volume={0.35} />
      <Sfx at={S.features - 4} name="whoosh" volume={0.4} />
      {copy.features.map((_, i) => (
        <Sfx key={i} at={S.features + FEATURE_AT(i)} name="pop" volume={0.45} />
      ))}
      <Sfx at={S.end + 2} name="ding" volume={0.5} />
    </AbsoluteFill>
  );
}
