/**
 * Measuring sound with FFmpeg: its loudness (shared/loudness.ts) with
 * ebur128, and its level every DUCK_STEP for finding speech
 * (shared/ducking.ts) with astats. The file's first sound stream is made
 * stereo at 48 kHz as the export's mix takes it, and of a working file
 * only the stretches the clip plays are measured, one after another.
 */
import { DUCK_STEP, parseLevels } from '../../shared/ducking.ts';
import { parseEbur128, type Loudness } from '../../shared/loudness.ts';
import type { LoudnessRequest } from '../../shared/worker-api.ts';
import { exec, ffmpegExe } from './exec.ts';
import { STEREO_48K } from './export.ts';

const MEASURE = 'ebur128=peak=true:framelog=quiet';
/** Levels are read at this rate, plenty for speech. */
const LEVEL_RATE = 8000;
const LEVELS =
  `aformat=sample_fmts=flt:channel_layouts=mono,aresample=${LEVEL_RATE},asetnsamples=n=${Math.round(LEVEL_RATE * DUCK_STEP)}:p=0,` +
  'astats=metadata=1:reset=1:measure_overall=RMS_level:measure_perchannel=none,ametadata=print:key=lavfi.astats.Overall.RMS_level';

/** FFmpeg arguments that run `measure` over `request`'s sound and write nothing. */
function measureArgs({ file, pieces }: LoudnessRequest, measure: string): string[] {
  const graph =
    pieces === null
      ? `[0:a:0]${STEREO_48K},${measure}[m]`
      : `${pieces
          .map((p, i) => `[0:a:0]atrim=start=${p.start.toFixed(6)}:end=${(p.start + p.duration).toFixed(6)},asetpts=PTS-STARTPTS,${STEREO_48K}[p${i}]`)
          .join(';')};${pieces.map((_, i) => `[p${i}]`).join('')}concat=n=${pieces.length}:v=0:a=1,${measure}[m]`;
  return ['-hide_banner', '-nostats', '-i', file, '-filter_complex', graph, '-map', '[m]', '-f', 'null', '-'];
}

export const loudnessArgs = (request: LoudnessRequest): string[] => measureArgs(request, MEASURE);

export const levelsArgs = (request: LoudnessRequest): string[] => measureArgs(request, LEVELS);

export async function measureLoudness(request: LoudnessRequest, signal: AbortSignal): Promise<Loudness> {
  const { stderr } = await exec(ffmpegExe(), loudnessArgs(request), { signal });
  return parseEbur128(stderr);
}

/** The sound's level in dB, one per DUCK_STEP from where it starts. */
export async function measureLevels(request: LoudnessRequest, signal: AbortSignal): Promise<number[]> {
  const { stderr } = await exec(ffmpegExe(), levelsArgs(request), { signal });
  return parseLevels(stderr);
}
