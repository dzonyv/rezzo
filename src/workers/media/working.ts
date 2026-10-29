import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { WorkingFileRequest } from '../../shared/worker-api.ts';
import { exec, ffmpegExe } from './exec.ts';
import type { JobContext } from './index.ts';

/** Larger sources are scaled down to fit this box; the export is 1080×1920. */
const MAX_WIDTH = 3840;
const MAX_HEIGHT = 2160;

const COLOR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

/**
 * The colour matrix the source was encoded with. Files that don't say are
 * guessed the way players do: HD and up is BT.709, SD is BT.601.
 */
function inputMatrix(colorSpace: string | null, height: number): string {
  if (colorSpace) return 'auto';
  return height >= 720 ? 'bt709' : 'bt601';
}

/**
 * FFmpeg arguments for a working file (decisions in spikes/REPORT.md):
 * H.264 without B-frames, a keyframe every 15 frames, constant frame rate,
 * BT.709 4:2:0, and only the first real video stream (`V` skips cover
 * images). Seeking before the input is frame-accurate when re-encoding.
 */
export function workingFileArgs(req: WorkingFileRequest, out: string): string[] {
  const [num, den] = req.frameRate;
  const scale = [
    `w='min(iw,${MAX_WIDTH})'`,
    `h='min(ih,${MAX_HEIGHT})'`,
    'force_original_aspect_ratio=decrease',
    'force_divisible_by=2',
    `in_color_matrix=${inputMatrix(req.colorSpace, req.height)}`,
    'out_color_matrix=bt709',
    'out_range=tv',
  ].join(':');
  return [
    '-y', '-v', 'error', '-nostats', '-progress', 'pipe:2',
    '-ss', req.start.toFixed(6), '-i', req.sourcePath, '-t', req.duration.toFixed(6),
    '-map', '0:V:0', '-map', '0:a:0?',
    // The encoder takes colour tags from the frames, so they're set on the frames too.
    '-vf', `scale=${scale},format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16',
    '-g', '15', '-keyint_min', '15', '-bf', '0',
    '-fps_mode', 'cfr', '-r', `${num}/${den}`,
    ...COLOR_TAGS,
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart', out,
  ];
}

/**
 * Converts one stretch of the source into a working file, unless it's
 * already there. x264 rather than NVENC: below 1080p NVENC isn't faster and
 * its files are bigger (Phase 1 checks in spikes/REPORT.md).
 */
export async function makeWorkingFile(ctx: JobContext, req: WorkingFileRequest): Promise<void> {
  try {
    if ((await stat(req.out)).size > 0) return;
  } catch {
    // not made yet
  }
  await mkdir(path.dirname(req.out), { recursive: true });
  // Unique, so a cancelled run cleaning up can't delete the file of the run that replaced it.
  const part = req.out.replace(/\.mp4$/, `.${randomUUID().slice(0, 8)}.part.mp4`);
  try {
    await exec(ffmpegExe(), workingFileArgs(req, part), {
      signal: ctx.signal,
      onStderrLine: (line) => {
        const m = /^out_time_us=(\d+)/.exec(line);
        if (m) ctx.progress(Math.min(1, Number(m[1]) / 1e6 / req.duration));
      },
    });
    await rename(part, req.out);
  } catch (e) {
    await rm(part, { force: true });
    throw e;
  }
}
