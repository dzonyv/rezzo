/**
 * Measuring loudness (shared/loudness.ts) with FFmpeg's ebur128: the
 * file's first sound stream, made stereo at 48 kHz as the export's mix
 * takes it, and of a working file only the stretches the clip plays.
 */
import { parseEbur128, type Loudness } from '../../shared/loudness.ts';
import type { LoudnessRequest } from '../../shared/worker-api.ts';
import { exec, ffmpegExe } from './exec.ts';
import { STEREO_48K } from './export.ts';

const MEASURE = 'ebur128=peak=true:framelog=quiet';

/** FFmpeg arguments that measure `request` and write nothing. */
export function loudnessArgs({ file, pieces }: LoudnessRequest): string[] {
  const graph =
    pieces === null
      ? `[0:a:0]${STEREO_48K},${MEASURE}[m]`
      : `${pieces
          .map((p, i) => `[0:a:0]atrim=start=${p.start.toFixed(6)}:end=${(p.start + p.duration).toFixed(6)},asetpts=PTS-STARTPTS,${STEREO_48K}[p${i}]`)
          .join(';')};${pieces.map((_, i) => `[p${i}]`).join('')}concat=n=${pieces.length}:v=0:a=1,${MEASURE}[m]`;
  return ['-hide_banner', '-nostats', '-i', file, '-filter_complex', graph, '-map', '[m]', '-f', 'null', '-'];
}

export async function measureLoudness(request: LoudnessRequest, signal: AbortSignal): Promise<Loudness> {
  const { stderr } = await exec(ffmpegExe(), loudnessArgs(request), { signal });
  return parseEbur128(stderr);
}
