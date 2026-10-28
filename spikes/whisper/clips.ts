import { readFileSync } from 'node:fs';
import path from 'node:path';
import { mediaDir } from '../shared/paths.ts';

/**
 * How to tell the people in a clip apart, for scoring speaker detection.
 * These rules only fit the Phase 0 test clips.
 *   seat:  a wide shot where nobody moves; left and right half of the frame
 *   shirt: close-ups told apart by a dark or light top just under the chin;
 *          in a two-shot, `twoShotLeft` sits on the left
 */
export type IdentityRule =
  | { rule: 'seat'; left: string; right: string }
  | { rule: 'shirt'; dark: string; light: string; twoShotLeft: string };

export interface Clip {
  /** Neutral id (clip-a, clip-b, ...) used in every output name. */
  id: string;
  file: string;
  /** Language spoken in the clip: sr, hr or bs. */
  lang: string;
  identity?: IdentityRule;
}

/**
 * The clips and what we know about them come from <media>/clips.json, which
 * lives next to the footage and never in the repo, so the repo doesn't say
 * which shows or people were used:
 *
 *   { "clips": [ { "file": "<video file name>", "id": "clip-a", "lang": "bs" }, ... ] }
 */
export function listClips(): Clip[] {
  const config = JSON.parse(readFileSync(path.join(mediaDir, 'clips.json'), 'utf8')) as { clips: Clip[] };
  return config.clips.map((c) => ({ ...c, file: path.join(mediaDir, c.file) }));
}

/**
 * Model whose output became the drafts the maintainer corrected. large-v3
 * loops on the noisy wide-shot clip (same segment four times); turbo doesn't,
 * which leaves less to fix by hand.
 */
export const DRAFT_MODEL = 'large-v3-turbo';

export const whisperDir = path.join(mediaDir, 'whisper');
export const reviewDir = path.join(whisperDir, 'review');
export const audioPath = (clip: Clip) => path.join(whisperDir, 'audio', `${clip.id}.wav`);
export const runsDir = (clip: Clip) => path.join(whisperDir, 'runs', clip.id);
