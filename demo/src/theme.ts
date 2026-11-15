import { continueRender, delayRender, staticFile } from 'remotion';

/** The app's own colours, from src/renderer/src/styles.css. */
export const C = {
  bg: '#12110e',
  surface: '#1d1b16',
  surface2: '#29261f',
  border: '#37332a',
  text: '#f6f2e7',
  dim: '#b0ab9d',
  accent: '#ffd400',
  accentText: '#171405',
};

export const FONT_DISPLAY = "'Unbounded', sans-serif";
export const FONT_UI = "'Onest', sans-serif";
export const FONT_CAPTION = "'Montserrat', sans-serif";

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

const fonts: [string, string, string][] = [
  ['Unbounded', 'fonts/Unbounded.ttf', '200 900'],
  ['Onest', 'fonts/Onest.ttf', '100 900'],
  ['Montserrat', 'fonts/Montserrat.ttf', '100 900'],
];

let loading: Promise<void> | null = null;

/** Loads the fonts once and holds the render until they are ready. */
export function loadFonts(): void {
  if (loading) return;
  const handle = delayRender('Loading fonts');
  loading = Promise.all(
    fonts.map(async ([family, file, weight]) => {
      const face = new FontFace(family, `url(${staticFile(file)})`, { weight });
      document.fonts.add(await face.load());
    }),
  ).then(() => continueRender(handle));
}
