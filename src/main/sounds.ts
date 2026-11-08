/**
 * The sound effects that come with the app: resources/sounds in the
 * source, resources/sounds next to app.asar once installed, where FFmpeg
 * can read them too.
 */
import { app } from 'electron';
import path from 'node:path';
import { z } from 'zod';
import { SOUND_NAMES, soundFileName, type SoundName } from '../shared/sounds.ts';
import { allowMedia } from './media-protocol.ts';

function soundsDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'sounds') : path.join(__dirname, '..', '..', 'resources', 'sounds');
}

/** The file of a sound from the library. */
export const librarySoundPath = (name: SoundName): string => path.join(soundsDir(), soundFileName(name));

/** A URL the page can read a sound from the library from. */
export function librarySoundUrl(nameArg: unknown): string {
  return allowMedia(librarySoundPath(z.enum(SOUND_NAMES).parse(nameArg)));
}
