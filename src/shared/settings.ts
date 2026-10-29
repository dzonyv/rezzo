import { z } from 'zod';

/** UI languages. `sh` is BCS (Bosnian, Croatian, Serbian; Latin script). */
export const UI_LANGUAGES = ['en', 'sh'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

export const settingsSchema = z.object({
  uiLanguage: z.enum(UI_LANGUAGES),
});
export type Settings = z.infer<typeof settingsSchema>;

/** A change to some of the settings, as sent by the renderer. */
export const settingsPatchSchema = settingsSchema.partial().strict();

/** BCS when the system is set to Bosnian, Croatian, Serbian or Montenegrin, English otherwise. */
export function defaultUiLanguage(systemLocale: string): UiLanguage {
  return /^(bs|hr|sr|sh|cnr)(\b|_|-|$)/i.test(systemLocale) ? 'sh' : 'en';
}
