/**
 * Generates the synthetic test source and the working-file variants.
 *
 *   node export/make-source.ts
 *
 * source.mp4: 1920x1080, 30 fps, 60 s, BT.709 limited range. Each frame shows
 * its number as 16 blocks along the top, 75% colour bars, a moving luma ramp,
 * and every second a one-frame white square together with a 50 ms 1 kHz beep.
 *
 * work-*.mp4: the same content re-encoded the way the app would prepare a
 * working file, with different keyframe intervals (for seek speed) and with
 * NVENC instead of x264 (for conversion speed).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mediaDir } from '../shared/paths.ts';
import { ffmpegExe, run } from '../shared/tools.ts';
import {
  BEEP_SECONDS, BITS, FLASH, FPS, SRC_BIT_W, SRC_BITS_ROWS, SRC_FRAMES, SRC_H, SRC_SECONDS, SRC_W,
} from './layout.ts';

const outDir = path.join(mediaDir, 'export');
await mkdir(outDir, { recursive: true });

const COLOR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

/** BT.709 limited-range Y'CbCr from gamma-encoded R'G'B' in 0..1. */
function yuv709(r: number, g: number, b: number): [number, number, number] {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [
    Math.round(16 + 219 * y),
    Math.round(128 + 224 * ((b - y) / 1.8556)),
    Math.round(128 + 224 * ((r - y) / 1.5748)),
  ];
}

const BARS: [number, number, number][] = [
  [0.75, 0.75, 0.75], [0.75, 0.75, 0], [0, 0.75, 0.75], [0, 0.75, 0],
  [0.75, 0, 0.75], [0.75, 0, 0], [0, 0, 0.75], [0, 0, 0],
];
const BARS_Y0 = 300;
const BARS_Y1 = 700;
const RAMP = { y0: 760, y1: 840, w: 300, speed: 16 };

const ySize = SRC_W * SRC_H;
const cW = SRC_W / 2;
const cSize = cW * (SRC_H / 2);

// Static part of every frame: black background with colour bars.
const base = Buffer.alloc(ySize + 2 * cSize);
base.fill(16, 0, ySize);
base.fill(128, ySize);
const barW = SRC_W / BARS.length;
for (let i = 0; i < BARS.length; i++) {
  const [Y, U, V] = yuv709(...BARS[i]);
  for (let y = BARS_Y0; y < BARS_Y1; y++) base.fill(Y, y * SRC_W + i * barW, y * SRC_W + (i + 1) * barW);
  for (let y = BARS_Y0 / 2; y < BARS_Y1 / 2; y++) {
    const x0 = (i * barW) / 2;
    base.fill(U, ySize + y * cW + x0, ySize + y * cW + x0 + barW / 2);
    base.fill(V, ySize + cSize + y * cW + x0, ySize + cSize + y * cW + x0 + barW / 2);
  }
}

function drawFrame(n: number): Buffer {
  const f = Buffer.from(base);
  for (let b = 0; b < BITS; b++) {
    const Y = (n >> b) & 1 ? 235 : 16;
    for (let y = 0; y < SRC_BITS_ROWS; y++) f.fill(Y, y * SRC_W + b * SRC_BIT_W, y * SRC_W + (b + 1) * SRC_BIT_W);
  }
  const rampX = (n * RAMP.speed) % (SRC_W - RAMP.w);
  for (let y = RAMP.y0; y < RAMP.y1; y++) {
    for (let x = 0; x < RAMP.w; x++) f[y * SRC_W + rampX + x] = 16 + Math.round((219 * x) / (RAMP.w - 1));
  }
  if (n % FPS === 0) {
    for (let y = FLASH.y; y < FLASH.y + FLASH.size; y++) f.fill(235, y * SRC_W + FLASH.x, y * SRC_W + FLASH.x + FLASH.size);
  }
  return f;
}

async function makeSource(file: string): Promise<number> {
  const t0 = performance.now();
  const beep = `aevalsrc='if(lt(mod(t,1),${BEEP_SECONDS}),0.5*sin(2*PI*1000*t),0)':s=48000:d=${SRC_SECONDS}`;
  const ff = spawn(ffmpegExe(), [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${SRC_W}x${SRC_H}`, '-r', String(FPS), ...COLOR_TAGS, '-i', 'pipe:0',
    '-f', 'lavfi', '-i', beep,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '12', '-g', '60', ...COLOR_TAGS,
    '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', file,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const exited = once(ff, 'exit');
  for (let n = 0; n < SRC_FRAMES; n++) {
    if (!ff.stdin.write(drawFrame(n))) await once(ff.stdin, 'drain');
  }
  ff.stdin.end();
  const [code] = await exited;
  if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
  return performance.now() - t0;
}

async function makeWorking(source: string, file: string, gop: number, encoder: 'x264' | 'nvenc'): Promise<number> {
  const t0 = performance.now();
  const video = encoder === 'x264'
    ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16']
    : ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '18', '-b:v', '0'];
  await run(ffmpegExe(), [
    '-y', '-hide_banner', '-i', source,
    ...video, '-g', String(gop), '-keyint_min', String(gop), '-bf', '0', '-pix_fmt', 'yuv420p', ...COLOR_TAGS,
    '-c:a', 'copy', '-movflags', '+faststart', file,
  ]);
  return performance.now() - t0;
}

const source = path.join(outDir, 'source.mp4');
const timings: Record<string, number> = {};
timings['source.mp4'] = await makeSource(source);
console.log(`source.mp4 in ${(timings['source.mp4'] / 1000).toFixed(1)} s`);

const variants: [string, number, 'x264' | 'nvenc'][] = [
  ['work-g1.mp4', 1, 'x264'],
  ['work-g15.mp4', 15, 'x264'],
  ['work-g30.mp4', 30, 'x264'],
  ['work-g60.mp4', 60, 'x264'],
  ['work-g30-nvenc.mp4', 30, 'nvenc'],
];
for (const [name, gop, encoder] of variants) {
  timings[name] = await makeWorking(source, path.join(outDir, name), gop, encoder);
  console.log(`${name} in ${(timings[name] / 1000).toFixed(1)} s`);
}

await writeFile(path.join(outDir, 'make-source.json'), JSON.stringify({ timingsMs: timings }, null, 2));
