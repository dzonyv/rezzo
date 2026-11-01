/**
 * Makes caption fonts available to the page: the bundled ones as files
 * next to the app's code, the ones the user added as bytes from the main
 * process. Canvas text uses whatever the document has loaded, so drawing
 * waits for ensureFont().
 */
import { BUNDLED_FONTS, cssFont, FALLBACK_FONT, hasFont, type CustomFont, type FontRef } from '../../../shared/fonts.ts';
import { currentSettings } from '../settings.ts';

const urls = import.meta.glob<string>('./*/*.{ttf,otf}', { query: '?url', import: 'default', eager: true });

let bundledAdded = false;

/** Tells the document about every bundled font; each loads only when first used. */
function addBundled(): void {
  if (bundledAdded) return;
  bundledAdded = true;
  for (const font of BUNDLED_FONTS) {
    for (const { weight, file } of font.files) {
      const url = urls[`./${font.folder}/${file}`];
      if (!url) throw new Error(`bundled font missing: ${font.folder}/${file}`);
      const face = new FontFace(font.family, `url("${url}")`, { weight: Array.isArray(weight) ? weight.join(' ') : String(weight) });
      document.fonts.add(face);
    }
  }
}

/** Added fonts already in the document, by file. */
const custom = new Map<string, Promise<void>>();

function addCustom(font: CustomFont): Promise<void> {
  let loading = custom.get(font.file);
  if (!loading) {
    loading = window.rezzo.invoke('fonts:read', font.file).then(async (bytes) => {
      const face = new FontFace(font.family, bytes as Uint8Array<ArrayBuffer>, { weight: String(font.weight) });
      document.fonts.add(await face.load());
    });
    // A failed read can be tried again later.
    loading.catch(() => custom.delete(font.file));
    custom.set(font.file, loading);
  }
  return loading;
}

/** Whether `font` is on this computer; otherwise captions use the fallback font. */
export function isAvailable(font: FontRef): boolean {
  return hasFont(font, currentSettings()?.fonts ?? []);
}

/** The font captions in `font` are actually drawn in here. */
export const resolveFont = (font: FontRef): FontRef => (isAvailable(font) ? font : FALLBACK_FONT);

/**
 * Loads the font text in `font` will be drawn in, and resolves with it once
 * the document can draw with it.
 */
export async function ensureFont(font: FontRef): Promise<FontRef> {
  addBundled();
  let resolved = resolveFont(font);
  const added = currentSettings()?.fonts.find((c) => c.family === resolved.family && c.weight === resolved.weight);
  if (added) {
    // An added font whose file has gone (or is damaged) is as good as missing.
    resolved = await addCustom(added).then(
      () => resolved,
      () => FALLBACK_FONT,
    );
  }
  try {
    await document.fonts.load(cssFont(resolved, 64));
  } catch (e) {
    if (resolved === FALLBACK_FONT) throw e;
    return ensureFont(FALLBACK_FONT);
  }
  return resolved;
}

/** For style previews in the UI: makes sure a font starts loading, without waiting for it. */
export function preloadFont(font: FontRef): void {
  void ensureFont(font).catch(() => {});
}
