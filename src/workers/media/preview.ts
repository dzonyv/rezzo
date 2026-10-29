import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { exec, ExecError, ffmpegExe } from './exec.ts';
import type { JobContext } from './index.ts';

/**
 * A 480p H.264/AAC copy for playing a source Chromium can't decode.
 * Keyframes every second keep seeking quick. NVENC first, x264 if the
 * machine has no NVIDIA encoder.
 */
export async function makePreview(ctx: JobContext, req: { sourcePath: string; duration: number; out: string }): Promise<void> {
  try {
    if ((await stat(req.out)).size > 0) return;
  } catch {
    // not made yet
  }
  await mkdir(path.dirname(req.out), { recursive: true });
  const part = req.out.replace(/\.mp4$/, '.part.mp4');
  const encoders = [
    ['-c:v', 'h264_nvenc', '-preset', 'p1', '-cq', '28'],
    ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26'],
  ];
  for (const [i, video] of encoders.entries()) {
    try {
      await exec(
        ffmpegExe(),
        ['-y', '-v', 'error', '-nostats', '-progress', 'pipe:2', '-i', req.sourcePath,
         '-map', '0:v:0', '-map', '0:a:0?', '-vf', 'scale=-2:480', ...video, '-g', '30', '-pix_fmt', 'yuv420p',
         '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', part],
        {
          signal: ctx.signal,
          onStderrLine: (line) => {
            const m = /^out_time_us=(\d+)/.exec(line);
            if (m) ctx.progress(Math.min(1, Number(m[1]) / 1e6 / req.duration));
          },
        },
      );
      await rename(part, req.out);
      return;
    } catch (e) {
      await rm(part, { force: true });
      if (ctx.signal.aborted || !(e instanceof ExecError) || i === encoders.length - 1) throw e;
    }
  }
}
