/**
 * Shared bits of the Phase 3b video-layer spike: where files go, the
 * synthetic reference with alpha, and pixel comparisons on raw RGBA frames.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { mediaDir } from '../shared/paths.ts';
import { ffmpegExe, ffprobeExe, run } from '../shared/tools.ts';

export const layersDir = path.join(mediaDir, 'layers');

export const FPS = 30;
export const REF_W = 1920;
export const REF_H = 1080;
export const REF_SECONDS = 4;
export const REF_FRAMES = REF_SECONDS * FPS;

/** Lossless RGBA reference (FFV1 in MKV), the "original" every candidate is compared with. */
export const referenceFile = path.join(layersDir, 'reference.mkv');

/** Frames compared in every quality check. */
export const SAMPLE_EVERY = 10;
export const sampleSelect = `select='not(mod(n\\,${SAMPLE_EVERY}))'`;

/**
 * A moving picture with every kind of alpha a real overlay has:
 * - a soft-edged circle that moves (feathered edges, like a keyed person),
 * - a hard-edged rectangle (logos, lower thirds),
 * - 2 px vertical lines (text strokes, thin detail),
 * - a horizontal alpha ramp along the bottom (precision of half-transparent areas).
 * The colour keeps going under transparent areas, as in straight-alpha
 * footage, and changes with X, Y and time so chroma bleeding shows.
 */
export function referenceFilter(w: number, h: number, seconds: number): string {
  const circle = `clip((150-hypot(X-${w}*(0.25+0.5*(0.5+0.5*sin(T*1.7))),Y-${h}*0.38))/24,0,1)`;
  const rect = `between(X,${w}*0.62+40*sin(T*2.3),${w}*0.62+40*sin(T*2.3)+260)*between(Y,${h}*0.08,${h}*0.45)`;
  const lines = `lt(mod(X,40),2)*between(Y,${h}*0.55,${h}*0.7)`;
  const ramp = `gt(Y,${h}*0.8)*X/${w}`;
  const alpha = `255*max(max(${circle},${rect}),max(${lines},${ramp}))`;
  return [
    `color=c=black:s=${w}x${h}:r=${FPS}:d=${seconds}`,
    'format=rgba',
    `geq=r='128+127*sin(X/97+T*2)':g='128+127*sin(Y/61+T*3+2)':b='128+127*sin((X+Y)/143+4)':a='${alpha}'`,
  ].join(',');
}

const TO_YUV = 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv';

export const align16 = (n: number): number => Math.ceil(n / 16) * 16;

/**
 * Rows per half of a stacked file: the alpha half starts on a macroblock row,
 * and at least two black rows separate it from the colour above. Without
 * them (720 rows, say) the GPU interpolates chroma across the seam and the
 * first alpha row picks up colour.
 */
export const stackedHalf = (contentH: number): number => align16(contentH + 2);

/**
 * The filter that turns a stream with alpha into the stacked layout: colour
 * on top, alpha as luma below. `planar` stays in YUV the whole way (alpha
 * plane copied out, expanded to limited range) instead of going through RGBA.
 */
export function stackedFilter(opts: { premultiply: boolean; halfHeight?: number; blackUnder?: boolean; planar?: boolean }): string {
  if (opts.planar) {
    const pad = opts.halfHeight ? `,pad=iw:${opts.halfHeight}:0:0:black` : '';
    return [
      '[0:v]scale=out_color_matrix=bt709:out_range=tv,format=yuva420p,split[c][a]',
      `[a]extractplanes=a,scale=in_range=pc:out_range=tv,format=yuv420p${pad}[a2]`,
      `[c]format=yuv420p${pad}[c2]`,
      `[c2][a2]vstack,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv[v]`,
    ].join(';');
  }
  // Round trip through premultiplied: same visible pixels, black under fully transparent ones.
  const matte = opts.blackUnder ? 'format=gbrap,premultiply=inplace=1,unpremultiply=inplace=1,' : '';
  const pad = opts.halfHeight ? `,pad=iw:${opts.halfHeight}:0:0:black` : '';
  // premultiply only takes planar formats.
  const color = opts.premultiply ? 'format=gbrap,premultiply=inplace=1,' : '';
  return [
    `[0:v]${matte}format=rgba,split[c][a]`,
    `[a]alphaextract,format=rgba${pad}[a2]`,
    `[c]${color}format=rgba${pad}[c2]`,
    `[c2][a2]vstack,${TO_YUV}[v]`,
  ].join(';');
}

export async function makeReference(): Promise<void> {
  await run(ffmpegExe(), [
    '-y', '-v', 'error', '-f', 'lavfi', '-i', referenceFilter(REF_W, REF_H, REF_SECONDS),
    '-c:v', 'ffv1', '-pix_fmt', 'bgra', referenceFile,
  ]);
}

/**
 * Decodes `file` to RGBA frames of `w`x`h`. `decoder` forces a decoder
 * (VP8/VP9 alpha needs libvpx), `filter` runs before the conversion to RGBA.
 */
export function readRgba(
  file: string,
  w: number,
  h: number,
  opts: { decoder?: string; filter?: string } = {},
): Promise<Buffer[]> {
  const vf = [opts.filter, 'format=rgba'].filter(Boolean).join(',');
  const args = [
    '-v', 'error',
    ...(opts.decoder ? ['-c:v', opts.decoder] : []),
    '-i', file, '-map', '0:v:0', '-vf', vf, '-fps_mode', 'passthrough',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegExe(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited with ${code} on ${file}\n${stderr.slice(-1500)}`));
      const all = Buffer.concat(chunks);
      const size = w * h * 4;
      const frames: Buffer[] = [];
      for (let o = 0; o + size <= all.length; o += size) frames.push(all.subarray(o, o + size));
      resolve(frames);
    });
  });
}

export interface StreamInfo {
  codec: string;
  pixFmt: string;
  alphaMode?: string;
  width: number;
  height: number;
}

export async function probe(file: string): Promise<StreamInfo> {
  const { stdout } = await run(ffprobeExe(), [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,pix_fmt,width,height:stream_tags=alpha_mode',
    '-of', 'json', file,
  ]);
  const s = JSON.parse(stdout).streams[0];
  return { codec: s.codec_name, pixFmt: s.pix_fmt, alphaMode: s.tags?.alpha_mode ?? s.tags?.ALPHA_MODE, width: s.width, height: s.height };
}

export const psnr = (sumSq: number, n: number): number =>
  sumSq === 0 ? Infinity : 10 * Math.log10((255 * 255 * n) / sumSq);

export const round = (x: number, digits = 1): number => (Number.isFinite(x) ? Number(x.toFixed(digits)) : x);

/** Mid-grey with a checkerboard, the background composites are judged on. */
export function backgroundAt(x: number, y: number): number {
  return ((x >> 5) + (y >> 5)) & 1 ? 96 : 160;
}
