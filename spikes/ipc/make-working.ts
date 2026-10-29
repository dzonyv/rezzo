/**
 * Converts each real test clip into a working file the way the app will
 * (H.264, no B-frames, keyframe every 15 frames, constant frame rate, BT.709
 * tags, first video stream only) and times it, once with libx264 and once
 * with NVENC. Writes <media>/ipc/work/<clip>-<encoder>.mp4 and
 * <media>/ipc/working.json.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mediaDir } from '../shared/paths.ts';
import { ffmpegExe, ffprobeExe, run } from '../shared/tools.ts';

const outDir = path.join(mediaDir, 'ipc', 'work');
await mkdir(outDir, { recursive: true });

const COLOR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
const ENCODERS = {
  x264: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16'],
  nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '18', '-b:v', '0'],
} as const;

const { clips } = JSON.parse(await readFile(path.join(mediaDir, 'clips.json'), 'utf8')) as {
  clips: { id: string; file: string }[];
};

/** r_frame_rate of the first video stream, e.g. "30/1" or "24000/1001". */
async function frameRate(file: string): Promise<string> {
  const { stdout } = await run(ffprobeExe(), [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', file,
  ]);
  return stdout.trim();
}

async function duration(file: string): Promise<number> {
  const { stdout } = await run(ffprobeExe(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(stdout.trim());
}

const results: Record<string, unknown> = {};
for (const clip of clips) {
  const source = path.join(mediaDir, clip.file);
  const rate = await frameRate(source);
  const seconds = await duration(source);
  const row: Record<string, unknown> = { rate, seconds: +seconds.toFixed(1) };

  for (const [encoder, video] of Object.entries(ENCODERS)) {
    const out = path.join(outDir, `${clip.id}-${encoder}.mp4`);
    const t0 = performance.now();
    await run(ffmpegExe(), [
      '-y', '-hide_banner', '-loglevel', 'error', '-i', source,
      '-map', '0:v:0', '-map', '0:a:0?',
      ...video, '-g', '15', '-keyint_min', '15', '-bf', '0', '-fps_mode', 'cfr', '-r', rate,
      '-pix_fmt', 'yuv420p', ...COLOR_TAGS,
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out,
    ]);
    const ms = performance.now() - t0;
    const { size } = await stat(out);
    row[encoder] = {
      seconds: +(ms / 1000).toFixed(1),
      realtime: +(seconds / (ms / 1000)).toFixed(1),
      mbPerMinute: +(size / 1e6 / (seconds / 60)).toFixed(1),
    };
    console.log(`${clip.id} ${encoder}: ${JSON.stringify(row[encoder])}`);
  }
  results[clip.id] = row;
}

await writeFile(path.join(mediaDir, 'ipc', 'working.json'), JSON.stringify(results, null, 2));
