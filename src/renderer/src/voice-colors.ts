/** One colour per voice, the same in the episode panel and on the clip timeline. */
const VOICE_COLORS = ['#e0a030', '#4aa3df', '#5cb85c', '#d9534f', '#9b6fd6', '#e07ab8', '#3fbfb0', '#a0a0a0'];

export const voiceColor = (voice: number): string => VOICE_COLORS[voice % VOICE_COLORS.length]!;
