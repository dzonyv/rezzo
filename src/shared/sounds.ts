/**
 * The sound effects that come with Rezzo, all CC0 (resources/sounds,
 * credited in CREDITS.md there), and what a sound layer plays: one of them
 * or a sound file of the user's own.
 */
import { z } from 'zod';

export const SOUND_GROUPS = ['click', 'camera', 'transition', 'pop', 'hit', 'signal', 'reaction'] as const;
export type SoundGroup = (typeof SOUND_GROUPS)[number];

/** Each sound's group and length in seconds; the file is resources/sounds/<name>.ogg. */
export const SOUNDS = {
  'mouse-click': { group: 'click', seconds: 0.153 },
  'camera-shutter': { group: 'camera', seconds: 0.302 },
  whoosh: { group: 'transition', seconds: 0.433 },
  swish: { group: 'transition', seconds: 0.344 },
  rise: { group: 'transition', seconds: 0.761 },
  sweep: { group: 'transition', seconds: 1.799 },
  pop: { group: 'pop', seconds: 0.198 },
  'pop-cartoon': { group: 'pop', seconds: 0.136 },
  punch: { group: 'hit', seconds: 0.492 },
  ding: { group: 'signal', seconds: 0.719 },
  blip: { group: 'signal', seconds: 0.086 },
  notification: { group: 'signal', seconds: 0.437 },
  'cash-register': { group: 'signal', seconds: 1.822 },
  wrong: { group: 'reaction', seconds: 1.069 },
  'record-scratch': { group: 'reaction', seconds: 1.469 },
  applause: { group: 'reaction', seconds: 6.567 },
  laugh: { group: 'reaction', seconds: 3.107 },
  crickets: { group: 'reaction', seconds: 7.242 },
} as const satisfies Record<string, { group: SoundGroup; seconds: number }>;

export type SoundName = keyof typeof SOUNDS;
export const SOUND_NAMES = Object.keys(SOUNDS) as [SoundName, ...SoundName[]];

export const soundFileName = (name: SoundName): string => `${name}.ogg`;

/** What a sound layer plays: a sound from the library, or one of the project's sound files. */
export const soundSourceSchema = z.union([z.object({ library: z.enum(SOUND_NAMES) }), z.object({ assetId: z.uuid() })]);
export type SoundSource = z.infer<typeof soundSourceSchema>;

/** The longest fade in or out a sound layer can have, in seconds. */
export const MAX_FADE_SECONDS = 10;
