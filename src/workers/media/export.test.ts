import { describe, expect, it } from 'vitest';
import type { ExportRequest } from '../../shared/worker-api.ts';
import { exportArgs, pickEncoder } from './export.ts';

const request = (patch: Partial<ExportRequest> = {}): ExportRequest => ({
  out: 'D:\\Klipovi\\klip.mp4',
  workingFile: 'D:\\cache\\work.mp4',
  audioStart: 2.002,
  duration: 31.031,
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
