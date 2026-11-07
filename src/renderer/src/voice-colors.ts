import type { TFunction } from 'i18next';

/** One colour per voice, the same in the episode panel and on the clip timeline. */
const VOICE_COLORS = ['#ffae73', '#8db8ff', '#8fd18a', '#ff8a8a', '#c3a3ff', '#f59ad0', '#6fd6c9', '#b0ab9d'];

export const voiceColor = (voice: number): string => VOICE_COLORS[voice % VOICE_COLORS.length]!;

/** What the UI calls a voice: its name, or "Voice 2". */
export const voiceLabel = (t: TFunction, voice: { id: number; name: string | null }): string => voice.name ?? t('voices.voice', { n: voice.id + 1 });
