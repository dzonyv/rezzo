import type { VideoInfo } from '../../shared/assets.ts';
import type { ProbeResult } from '../../shared/worker-api.ts';
import { exec, ffmpegExe, ffprobeExe } from './exec.ts';

interface FfprobeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  color_space?: string;
  pix_fmt?: string;
  sample_rate?: string;
  channels?: number;
  disposition?: { attached_pic?: number };
  tags?: Record<string, string>;
  side_data_list?: { rotation?: number }[];
}

export interface FfprobeJson {
  streams?: FfprobeStream[];
  format?: { duration?: string };
}

export class ProbeError extends Error {
  readonly code: 'unreadable' | 'no-video';

  constructor(code: ProbeError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export async function probe(file: string): Promise<ProbeResult> {
  let stdout: string;
  try {
    ({ stdout } = await exec(ffprobeExe(), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
  } catch (e) {
    throw new ProbeError('unreadable', String(e));
  }
  return parseProbe(JSON.parse(stdout) as FfprobeJson);
}

function fraction(text: string | undefined): [number, number] | null {
  const m = /^(\d+)\/(\d+)$/.exec(text ?? '');
  if (!m) return null;
  const num = Number(m[1]);
  const den = Number(m[2]);
  return num > 0 && den > 0 ? [num, den] : null;
}

/** Turns ffprobe's JSON into what the project records about the source. */
export function parseProbe(json: FfprobeJson): ProbeResult {
  const streams = json.streams ?? [];
  const video = videoStreamOf(json);

  const nominal = fraction(video.r_frame_rate) ?? fraction(video.avg_frame_rate);
  if (!nominal) throw new ProbeError('unreadable', `no frame rate (${video.r_frame_rate})`);
  const average = fraction(video.avg_frame_rate);
  const rate = (f: [number, number]) => f[0] / f[1];
  // Constant-rate files report the same average; allow for rounding in the container.
  const variableFrameRate = average !== null && Math.abs(rate(average) - rate(nominal)) / rate(nominal) > 0.0005;

  const duration = Number(json.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new ProbeError('unreadable', 'no duration');

  const audio = streams.find((s) => s.codec_type === 'audio');
  const colorSpace = video.color_space && video.color_space !== 'unknown' ? video.color_space : null;

  return {
    duration,
    video: {
      codec: video.codec_name ?? 'unknown',
      width: video.width,
      height: video.height,
      frameRate: nominal,
      variableFrameRate,
      colorSpace,
    },
    audio:
      audio && audio.sample_rate && audio.channels
        ? { codec: audio.codec_name ?? 'unknown', sampleRate: Number(audio.sample_rate), channels: audio.channels }
        : null,
  };
}

/**
 * FFmpeg's own VP8/VP9 decoders drop the alpha channel; only libvpx keeps
 * it (spikes/REPORT.md, Phase 3 checks). Null: the default decoder is fine.
 */
export function alphaDecoder(codec: string): string | null {
  if (codec === 'vp9') return 'libvpx-vp9';
  if (codec === 'vp8') return 'libvpx';
  return null;
}

/** Pixel formats with an alpha channel: yuva420p, rgba, argb, bgra, gbrap, ya8 and the like. */
export const hasAlphaChannel = (pixFmt: string | undefined): boolean => /^(yuva|gbrap|ya\d|rgba|bgra|argb|abgr|ayuv)/.test(pixFmt ?? '');

/**
 * Whether the stream has alpha as far as the stream itself says: true when
 * it's certain, null when only a decoded frame can tell. WebM
 * marks alpha with a tag while its pix_fmt says yuv420p; HEVC with alpha
 * says yuv420p on the stream and yuva420p on its frames.
 */
export function streamAlpha(stream: Pick<FfprobeStream, 'pix_fmt' | 'tags'>): boolean | null {
  const mode = stream.tags?.alpha_mode ?? stream.tags?.ALPHA_MODE;
  if (mode === '1' || hasAlphaChannel(stream.pix_fmt)) return true;
  return null;
}

/** The first real video stream; cover images show up as a video stream marked "attached_pic". */
/**
 * Packed RGB formats with an alpha channel. GIF always decodes to one of
 * these and screen recordings in QuickTime Animation often do, transparent
 * or not, so for them the channel alone doesn't mean a transparent background.
 */
export const isPackedRgba = (pixFmt: string | undefined): boolean => /^(rgba|bgra|argb|abgr)/.test(pixFmt ?? '');

/** Frames looked at for transparent pixels; a GIF that turns transparent later than this is taken as opaque. */
const ALPHA_CHECK_FRAMES = 60;

/** The lowest alpha in signalstats output for the alpha plane (lavfi.signalstats.YMIN per frame); 255 when there's none. */
export function lowestAlpha(metadata: string): number {
  let lowest = 255;
  for (const m of metadata.matchAll(/lavfi\.signalstats\.YMIN=(\d+)/g)) lowest = Math.min(lowest, Number(m[1]));
  return lowest;
}

/** Whether any of the first frames of stream `index` has a pixel that isn't fully opaque. */
async function hasTransparentPixels(file: string, index: number): Promise<boolean> {
  const { stdout } = await exec(ffmpegExe(), [
    '-v', 'error', '-i', file, '-map', `0:${index}`, '-frames:v', String(ALPHA_CHECK_FRAMES),
    '-vf', 'alphaextract,signalstats,metadata=print:key=lavfi.signalstats.YMIN:file=-', '-f', 'null', '-',
  ]);
  return lowestAlpha(stdout) < 255;
}

function videoStreamOf(json: FfprobeJson): FfprobeStream & { width: number; height: number } {
  const video = (json.streams ?? []).find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!video || !video.width || !video.height) throw new ProbeError('no-video', 'no video stream');
  return video as FfprobeStream & { width: number; height: number };
}

/**
 * Turns ffprobe's JSON for a video layer's file into what the asset records.
 * `alpha` is the answer from the first decoded frame when the stream alone
 * couldn't tell.
 */
export function parseVideoInfo(json: FfprobeJson, alpha: boolean): VideoInfo {
  const video = videoStreamOf(json);
  const frameRate = fraction(video.r_frame_rate) ?? fraction(video.avg_frame_rate);
  if (!frameRate) throw new ProbeError('unreadable', `no frame rate (${video.r_frame_rate})`);
  const duration = Number(json.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new ProbeError('unreadable', 'no duration');
  // Phone videos are often stored sideways with a rotation tag; FFmpeg turns them upright when converting.
  const rotation = video.side_data_list?.find((d) => typeof d.rotation === 'number')?.rotation ?? 0;
  const sideways = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  return {
    codec: video.codec_name ?? 'unknown',
    width: sideways ? video.height : video.width,
    height: sideways ? video.width : video.height,
    duration,
    frameRate,
    colorSpace: video.color_space && video.color_space !== 'unknown' ? video.color_space : null,
    alpha,
    hasAudio: (json.streams ?? []).some((s) => s.codec_type === 'audio'),
  };
}

/** Reads a video layer's file, including whether it has a transparent background. */
export async function probeVideo(file: string): Promise<VideoInfo> {
  let json: FfprobeJson;
  try {
    const { stdout } = await exec(ffprobeExe(), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]);
    json = JSON.parse(stdout) as FfprobeJson;
  } catch (e) {
    throw new ProbeError('unreadable', String(e));
  }
  const video = videoStreamOf(json);
  let alpha = streamAlpha(video);
  if (alpha && isPackedRgba(video.pix_fmt)) {
    try {
      alpha = await hasTransparentPixels(file, video.index);
    } catch (e) {
      throw new ProbeError('unreadable', String(e));
    }
  } else if (alpha === null) {
    try {
      const decoder = alphaDecoder(video.codec_name ?? '');
      const { stdout } = await exec(ffprobeExe(), [
        '-v', 'error', ...(decoder ? ['-c:v', decoder] : []), '-select_streams', String(video.index),
        '-read_intervals', '%+#1', '-show_entries', 'frame=pix_fmt', '-of', 'json', file,
      ]);
      const frames = (JSON.parse(stdout) as { frames?: { pix_fmt?: string }[] }).frames ?? [];
      alpha = hasAlphaChannel(frames[0]?.pix_fmt);
    } catch (e) {
      throw new ProbeError('unreadable', String(e));
    }
  }
  return parseVideoInfo(json, alpha);
}
