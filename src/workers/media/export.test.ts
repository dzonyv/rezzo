import { describe, expect, it } from 'vitest';
import type { ExportRequest } from '../../shared/worker-api.ts';
import { exportArgs, pickEncoder } from './export.ts';

const request = (patch: Partial<ExportRequest> = {}): ExportRequest => ({
  out: 'D:\\Klipovi\\klip.mp4',
  workingFile: 'D:\\cache\\work.mp4',
  audioStart: 2.002,
  duration: 31.031,
  hasAudio: true,
  sounds: [],
  frameRate: [30000, 1001],
  frames: 930,
  encoder: 'nvenc',
  ...patch,
});

const arg = (args: string[], flag: string, from = 0) => args[args.indexOf(flag, from) + 1];

describe('export arguments', () => {
  it('reads raw 1080×1920 yuv420p frames at the working file rate from stdin', () => {
    const args = exportArgs(request(), 'out.part');
    expect(arg(args, '-f')).toBe('rawvideo');
    expect(arg(args, '-pix_fmt')).toBe('yuv420p');
    expect(arg(args, '-s')).toBe('1080x1920');
    expect(arg(args, '-framerate')).toBe('30000/1001');
    expect(arg(args, '-i')).toBe('pipe:0');
  });

  it("takes the clip's sound from the working file, and none if it has no sound", () => {
    const args = exportArgs(request(), 'out.part');
    const second = args.indexOf('-i', args.indexOf('pipe:0'));
    expect(args[second + 1]).toBe('D:\\cache\\work.mp4');
    expect(args.indexOf('-ss')).toBeLessThan(second);
    expect(arg(args, '-ss')).toBe('2.002000');
    expect(arg(args, '-t')).toBe('31.031000');
    expect(args).toContain('1:a:0?');
    expect(arg(args, '-c:a')).toBe('aac');
  });

  it("mixes video layers' sound over the clip's, each stretch delayed to where it plays", () => {
    const sounds = [
      { file: 'a.mp4', start: 1.5, duration: 2, at: 3.25, volume: 0.5 },
      { file: 'b.mp4', start: 0, duration: 1, at: 0, volume: 1 },
    ];
    const args = exportArgs(request({ sounds }), 'out.part');
    const inputs = args.flatMap((a, i) => (a === '-i' ? [args[i + 1]] : []));
    expect(inputs).toEqual(['pipe:0', 'D:\\cache\\work.mp4', 'a.mp4', 'b.mp4']);
    const a = args.indexOf('a.mp4');
    expect(args.slice(a - 5, a)).toEqual(['-ss', '1.500000', '-t', '2.000000', '-i']);
    const graph = arg(args, '-filter_complex')!;
    expect(graph).toContain('[1:a:0]aformat=sample_rates=48000:channel_layouts=stereo[a0]');
    expect(graph).toContain('[2:a:0]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.5000,adelay=3250:all=1[s0]');
    expect(graph).toContain('[3:a:0]aformat=sample_rates=48000:channel_layouts=stereo,volume=1.0000,adelay=0:all=1[s1]');
    expect(graph).toContain('[a0][s0][s1]amix=inputs=3:normalize=0:duration=longest,apad,atrim=end=31.031000[a]');
    expect(args.filter((x, i) => args[i - 1] === '-map')).toEqual(['0:v', '[a]']);
  });

  it("mixes layers' sound into silence when the source has none", () => {
    const args = exportArgs(request({ hasAudio: false, sounds: [{ file: 'b.mp4', start: 0, duration: 1, at: 2, volume: 1 }] }), 'o');
    const graph = arg(args, '-filter_complex')!;
    expect(graph).not.toContain('[1:a');
    expect(graph).toContain('[s0]amix=inputs=1:normalize=0');
  });

  it('uses the chosen encoder with a keyframe every two seconds', () => {
    expect(arg(exportArgs(request(), 'o'), '-c:v')).toBe('h264_nvenc');
    expect(arg(exportArgs(request({ encoder: 'x264' }), 'o'), '-c:v')).toBe('libx264');
    expect(arg(exportArgs(request(), 'o'), '-g')).toBe('60');
    expect(arg(exportArgs(request({ frameRate: [25, 1] }), 'o'), '-g')).toBe('50');
  });

  it('tags BT.709 and writes an MP4 that starts playing before it has fully loaded', () => {
    const args = exportArgs(request(), 'out.part');
    const output = args.indexOf('-c:v');
    expect(arg(args, '-colorspace', output)).toBe('bt709');
    expect(arg(args, '-color_primaries', output)).toBe('bt709');
    expect(arg(args, '-color_trc', output)).toBe('bt709');
    expect(arg(args, '-movflags')).toBe('+faststart');
    expect(args.slice(-3)).toEqual(['-f', 'mp4', 'out.part']);
  });

  it('lets tests force the encoder', async () => {
    process.env['REZZO_ENCODER'] = 'x264';
    try {
      await expect(pickEncoder()).resolves.toBe('x264');
    } finally {
      delete process.env['REZZO_ENCODER'];
    }
  });
});
