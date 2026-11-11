import { describe, expect, it } from 'vitest';
import type { ExportRequest } from '../../shared/worker-api.ts';
import { exportArgs, pickEncoder } from './export.ts';

const request = (patch: Partial<ExportRequest> = {}): ExportRequest => ({
  out: 'D:\\Klipovi\\klip.mp4',
  workingFile: 'D:\\cache\\work.mp4',
  audioPieces: [{ start: 2.002, duration: 31.031 }],
  duration: 31.031,
  hasAudio: true,
  gain: 1,
  sounds: [],
  frameRate: [30000, 1001],
  frames: 930,
  encoder: 'nvenc',
  ...patch,
});

const arg = (args: string[], flag: string, from = 0) => args[args.indexOf(flag, from) + 1];

describe('export arguments', () => {
  it('joins the pieces of a clip with skips, and leaves a whole clip in one piece', () => {
    const whole = exportArgs(request(), 'out.part');
    expect(arg(whole, '-filter_complex')).toBe(
      '[1:a:0]aformat=sample_rates=48000:channel_layouts=stereo[a0];[a0]anull,apad,atrim=end=31.031000,alimiter=limit=0.8913:attack=5:release=50:level=false:latency=true[a]',
    );
    expect(arg(whole, '-ss')).toBe('2.002000');
    expect(arg(whole, '-t')).toBe('31.031000');

    const args = exportArgs(request({ audioPieces: [{ start: 2, duration: 3 }, { start: 6, duration: 4 }], duration: 7 }), 'out.part');
    expect(arg(args, '-ss')).toBe('2.000000');
    expect(arg(args, '-t')).toBe('8.000000');
    const graph = arg(args, '-filter_complex')!;
    expect(graph).toContain('atrim=start=0.000000:end=3.000000');
    expect(graph).toContain('atrim=start=4.000000:end=8.000000');
    expect(graph).toContain('afade=t=out:st=2.990000:d=0.01');
    expect(graph).toContain('afade=t=in:d=0.01');
    expect(graph).toContain('concat=n=2:v=0:a=1[a0]');
    expect(graph).toContain('atrim=end=7.000000,alimiter=');
  });

  it("turns the clip's own sound up or down by its gain, before the layers join it", () => {
    expect(arg(exportArgs(request({ gain: 2.5 }), 'o'), '-filter_complex')).toContain('[1:a:0]aformat=sample_rates=48000:channel_layouts=stereo,volume=2.5000[a0]');
    const joined = arg(exportArgs(request({ gain: 0.5, audioPieces: [{ start: 2, duration: 3 }, { start: 6, duration: 4 }], duration: 7 }), 'o'), '-filter_complex');
    expect(joined).toContain('concat=n=2:v=0:a=1,volume=0.5000[a0]');
  });

  it('has no sound at all in a clip without any', () => {
    const args = exportArgs(request({ hasAudio: false, audioPieces: [{ start: 2, duration: 3 }, { start: 6, duration: 4 }], duration: 7 }), 'out.part');
    expect(args).not.toContain('-filter_complex');
    expect(args.filter((x, i) => args[i - 1] === '-map')).toEqual(['0:v']);
  });

  it('reads raw 1080×1920 yuv420p frames at the working file rate from stdin', () => {
    const args = exportArgs(request(), 'out.part');
    expect(arg(args, '-f')).toBe('rawvideo');
    expect(arg(args, '-pix_fmt')).toBe('yuv420p');
    expect(arg(args, '-s')).toBe('1080x1920');
    expect(arg(args, '-framerate')).toBe('30000/1001');
    expect(arg(args, '-i')).toBe('pipe:0');
  });

  it("takes the clip's sound from the working file", () => {
    const args = exportArgs(request(), 'out.part');
    const second = args.indexOf('-i', args.indexOf('pipe:0'));
    expect(args[second + 1]).toBe('D:\\cache\\work.mp4');
    expect(args.indexOf('-ss')).toBeLessThan(second);
    expect(arg(args, '-ss')).toBe('2.002000');
    expect(arg(args, '-t')).toBe('31.031000');
    expect(arg(args, '-filter_complex')).toContain('[1:a:0]');
    expect(arg(args, '-c:a')).toBe('aac');
  });

  it("mixes layers' sound over the clip's, each delayed to where it plays", () => {
    const sounds = [
      { file: 'a.mp4', start: 1.5, duration: 2, loop: false, period: 4, at: 3.25, volume: 0.5, fadeIn: 0, fadeOut: 0, duck: null },
      { file: 'b.mp4', start: 0, duration: 1, loop: false, period: 1, at: 0, volume: 1, fadeIn: 0, fadeOut: 0, duck: null },
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
    expect(graph).toContain('[a0][s0][s1]amix=inputs=3:normalize=0:duration=longest,apad,atrim=end=31.031000,alimiter=');
    expect(args.filter((x, i) => args[i - 1] === '-map')).toEqual(['0:v', '[a]']);
  });

  it("mixes layers' sound into silence when the source has none", () => {
    const args = exportArgs(request({ hasAudio: false, sounds: [{ file: 'b.mp4', start: 0, duration: 1, loop: false, period: 1, at: 2, volume: 1, fadeIn: 0, fadeOut: 0, duck: null }] }), 'o');
    const graph = arg(args, '-filter_complex')!;
    expect(graph).not.toContain('[1:a');
    expect(graph).toContain('[s0]anull,apad');
  });

  it("fades a layer's sound in and out where it plays", () => {
    const args = exportArgs(request({ sounds: [{ file: 'm.mp3', start: 4, duration: 10, loop: false, period: 60, at: 1, volume: 0.3, fadeIn: 1.5, fadeOut: 2, duck: null }] }), 'o');
    expect(arg(args, '-filter_complex')).toContain(
      '[2:a:0]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.3000,afade=t=in:d=1.500000,afade=t=out:st=8.000000:d=2.000000,adelay=1000:all=1[s0]',
    );
  });

  it('multiplies a sound turned down under speech by its gain signal before delaying it', () => {
    const duck = [{ t: 0.85, gain: 1 }, { t: 1, gain: 0.25 }, { t: 2, gain: 0.25 }, { t: 2.4, gain: 1 }];
    const sounds = [
      { file: 'a.wav', start: 0, duration: 1, loop: false, period: 1, at: 0, volume: 1, fadeIn: 0, fadeOut: 0, duck: null },
      { file: 'm.mp3', start: 0, duration: 3, loop: false, period: 60, at: 0.5, volume: 0.3, fadeIn: 0, fadeOut: 0, duck },
    ];
    const args = exportArgs(request({ sounds }), 'o', [null, 'D:\\tmp\\rezzo-duck-1.f32']);
    const inputs = args.flatMap((a, i) => (a === '-i' ? [args[i + 1]] : []));
    // The gain signals come after all the sounds' files.
    expect(inputs).toEqual(['pipe:0', 'D:\\cache\\work.mp4', 'a.wav', 'm.mp3', 'D:\\tmp\\rezzo-duck-1.f32']);
    const g = args.indexOf('D:\\tmp\\rezzo-duck-1.f32');
    expect(args.slice(g - 7, g)).toEqual(['-f', 'f32le', '-ar', '48000', '-ac', '1', '-i']);
    const graph = arg(args, '-filter_complex')!;
    expect(graph).toContain('[2:a:0]aformat=sample_rates=48000:channel_layouts=stereo,volume=1.0000,adelay=0:all=1[s0]');
    expect(graph).toContain('[3:a:0]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.3000,aformat=sample_fmts=fltp[x1]');
    expect(graph).toContain('[4:a:0]aformat=sample_fmts=fltp:channel_layouts=stereo[g1]');
    expect(graph).toContain('[x1][g1]amultiply,adelay=500:all=1[s1]');
  });

  it('loops exactly the period of a looping sound, then cuts it to what plays', () => {
    const args = exportArgs(request({ sounds: [{ file: 'click.ogg', start: 0.1, duration: 5, loop: true, period: 0.3, at: 0, volume: 1, fadeIn: 0, fadeOut: 0, duck: null }] }), 'o');
    const i = args.indexOf('click.ogg');
    expect(args[i - 2]).not.toBe('-t');
    expect(arg(args, '-filter_complex')).toContain(
      '[2:a:0]atrim=end=0.300000,aformat=sample_rates=48000:channel_layouts=stereo,aloop=loop=-1:size=14400,atrim=start=0.100000:duration=5.000000,asetpts=PTS-STARTPTS,volume=',
    );
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
