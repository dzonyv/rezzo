import { z } from 'zod';
import { captionStyleSchema, DEFAULT_CAPTION_STYLE, savedStyleSchema } from './caption-style.ts';
import { customFontSchema } from './fonts.ts';
import { replacementSchema } from './replacements.ts';
import { PLATFORMS } from './safe-zones.ts';

/** UI languages. `sh` is Serbian in Latin script; the code stays `sh` so saved settings keep working. */
export const UI_LANGUAGES = ['en', 'sh'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

/** How much room the clip editor's timeline takes: a strip, a resizable dock, or all of it beside a small picture. */
export const DOCK_SIZES = ['compact', 'normal', 'full'] as const;
export type DockSize = (typeof DOCK_SIZES)[number];

export const clipDockSchema = z.object({
  size: z.enum(DOCK_SIZES),
  /** The dock's height in 'normal', in CSS pixels, as last dragged. */
  height: z.number().min(120).max(4000),
});
export type ClipDock = z.infer<typeof clipDockSchema>;
export const DEFAULT_CLIP_DOCK: ClipDock = { size: 'normal', height: 360 };

export const settingsSchema = z.object({
  uiLanguage: z.enum(UI_LANGUAGES),
  /** The folder of the last export, offered again next time; null until the first one. */
  exportDir: z.string().min(1).nullable(),
  /** Corrections applied to every new transcript (shared/replacements.ts). */
  replacements: z.array(replacementSchema).max(1000),
  /** Caption styles the user saved, for every project. */
  captionStyles: z.array(savedStyleSchema).max(100),
  /** The style new clips get. */
  defaultCaptionStyle: captionStyleSchema,
  /** Fonts the user added; only the main process adds them, after checking the file. */
  fonts: z.array(customFontSchema).max(200),
  /** The clip editor's timeline, as the user left it. */
  clipDock: clipDockSchema,
  /** Whose buttons the clip editor shows over the picture (shared/safe-zones.ts), or nobody's. */
  safeZones: z.enum(['off', ...PLATFORMS]),
});
export type Settings = z.infer<typeof settingsSchema>;

/** A change to some of the settings, as sent by the renderer. Folders are only set by the main process. */
export const settingsPatchSchema = settingsSchema.omit({ exportDir: true, fonts: true }).partial().strict();

export function defaultSettings(uiLanguage: UiLanguage): Settings {
  return {
    uiLanguage,
    exportDir: null,
    replacements: [],
    captionStyles: [],
    defaultCaptionStyle: DEFAULT_CAPTION_STYLE,
    fonts: [],
    clipDock: DEFAULT_CLIP_DOCK,
    safeZones: 'off',
  };
}

/**
 * Serbian when the system is set to Bosnian, Croatian, Serbian or
 * Montenegrin, English otherwise: people on those systems read the Serbian
 * interface more easily than English, and can switch on the home screen.
 */
export function defaultUiLanguage(systemLocale: string): UiLanguage {
  return /^(bs|hr|sr|sh|cnr)(\b|_|-|$)/i.test(systemLocale) ? 'sh' : 'en';
}
