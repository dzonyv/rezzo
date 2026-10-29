import type { ProbeResult } from '../../shared/worker-api.ts';
import { exec, ffprobeExe } from './exec.ts';

interface FfprobeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  color_space?: string;
  sample_rate?: string;
  channels?: number;
  disposition?: { attached_pic?: number };
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
  // Cover images show up as a video stream marked "attached_pic"; skip them.
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!video || !video.width || !video.height) throw new ProbeError('no-video', 'no video stream');

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
