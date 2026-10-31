import { z } from 'zod';
import { TRANSCRIPT_LANGUAGES } from './project.ts';
import { replacementSchema } from './replacements.ts';

/** UI languages. `sh` is BCS (Bosnian, Croatian, Serbian; Latin script). */
export const UI_LANGUAGES = ['en', 'sh'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

export const settingsSchema = z.object({
  uiLanguage: z.enum(UI_LANGUAGES),
  /** The language picked for the last transcription, offered again next time. */
  transcriptLanguage: z.enum(TRANSCRIPT_LANGUAGES),
  /** The folder of the last export, offered again next time; null until the first one. */
  exportDir: z.string().min(1).nullable(),
  /** Corrections applied to every new transcript (shared/replacements.ts). */
  replacements: z.array(replacementSchema).max(1000),
});
export type Settings = z.infer<typeof settingsSchema>;

/** A change to some of the settings, as sent by the renderer. Folders are only set by the main process. */
export const settingsPatchSchema = settingsSchema.omit({ exportDir: true }).partial().strict();

/** BCS when the system is set to Bosnian, Croatian, Serbian or Montenegrin, English otherwise. */
export function defaultUiLanguage(systemLocale: string): UiLanguage {
  return /^(bs|hr|sr|sh|cnr)(\b|_|-|$)/i.test(systemLocale) ? 'sh' : 'en';
}
