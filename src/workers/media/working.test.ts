import { describe, expect, it } from 'vitest';
import type { OverlayFileRequest, WorkingFileRequest } from '../../shared/worker-api.ts';
import { overlayFileArgs, workingFileArgs } from './working.ts';

const request = (patch: Partial<WorkingFileRequest> = {}): WorkingFileRequest => ({
  sourcePath: 'D:\\Video\\epizoda.mkv',
  start: 8.04,
  duration: 13.96,
  frameRate: [30000, 1001],
  colorSpace: 'bt709',
  height: 1080,
  out: 'D:\\cache\\work.mp4',
  ...patch,
});

const arg = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe('working file arguments', () => {
  it('cuts the stretch frame-accurately with seeking before the input', () => {
    const args = workingFileArgs(request(), 'out.mp4');
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(arg(args, '-ss')).toBe('8.040000');
    expect(arg(args, '-t')).toBe('13.960000');
    expect(args.at(-1)).toBe('out.mp4');
  });

  it('makes H.264 without B-frames, a keyframe every 15 frames, at a constant rate', () => {
    const args = workingFileArgs(request(), 'out.mp4');
    expect(arg(args, '-c:v')).toBe('libx264');
    expect(arg(args, '-bf')).toBe('0');
    expect(arg(args, '-g')).toBe('15');
    expect(arg(args, '-fps_mode')).toBe('cfr');
    expect(arg(args, '-r')).toBe('30000/1001');
    expect(arg(args, '-colorspace')).toBe('bt709');
  });

  it('takes the first real video stream, skipping cover images', () => {
    expect(workingFileArgs(request(), 'o.mp4').filter((a) => a.startsWith('0:'))).toEqual(['0:V:0', '0:a:0?']);
  });

  it('converts colours to BT.709, guessing for files that say nothing', () => {
    const vf = (r: WorkingFileRequest) => arg(workingFileArgs(r, 'o.mp4'), '-vf')!;
    expect(vf(request())).toContain('in_color_matrix=auto');
    expect(vf(request({ colorSpace: null, height: 720 }))).toContain('in_color_matrix=bt709');
    expect(vf(request({ colorSpace: null, height: 480 }))).toContain('in_color_matrix=bt601');
    expect(vf(request())).toMatch(/out_color_matrix=bt709.*format=yuv420p,setparams=.*color_trc=bt709/);
  });
});

const overlay = (patch: Partial<OverlayFileRequest> = {}): OverlayFileRequest => ({
  path: 'D:\\Video\\konfete.webm',
  codec: 'vp9',
  colorSpace: null,
  sourceHeight: 1080,
  alpha: true,
  start: 0,
  duration: 4,
  frameRate: [30, 1],
  width: 1080,
  height: 608,
  out: 'D:\\cache\\overlay.mp4',
  ...patch,
});

describe('video layer working file arguments', () => {
  it('converts to the clip frame rate and the planned size, as H.264 like every working file', () => {
    const args = overlayFileArgs(overlay({ alpha: false, codec: 'h264' }), 'o.mp4');
    const graph = arg(args, '-filter_complex')!;
    expect(graph.startsWith('[0:V:0]fps=30/1,scale=w=1080:h=608:in_color_matrix=bt709:out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=')).toBe(true);
    expect(arg(args, '-c:v')).toBe('libx264');
    expect(arg(args, '-bf')).toBe('0');
    expect(arg(args, '-g')).toBe('15');
    expect(arg(args, '-r')).toBe('30/1');
    expect(args.filter((a) => a.startsWith('0:') || a === '[v]')).toEqual(['[v]', '0:a:0?']);
  });

  it('stacks colour over alpha, each half padded to a macroblock row with a gap', () => {
    const graph = arg(overlayFileArgs(overlay(), 'o.mp4'), '-filter_complex')!;
    expect(graph).toContain('format=yuva420p,split[c][a]');
    expect(graph).toContain('[a]extractplanes=a,scale=in_range=pc:out_range=tv,format=yuv420p,pad=iw:624:0:0:black[a2]');
    expect(graph).toContain('[c]format=yuv420p,pad=iw:624:0:0:black[c2]');
    expect(graph).toContain('[c2][a2]vstack');
  });

  it('decodes VP8 and VP9 alpha with libvpx, and only when there is alpha', () => {
    const before = (args: string[]) => args.slice(0, args.indexOf('-i'));
    expect(before(overlayFileArgs(overlay(), 'o.mp4'))).toEqual(expect.arrayContaining(['-c:v', 'libvpx-vp9']));
    expect(before(overlayFileArgs(overlay({ codec: 'vp8' }), 'o.mp4'))).toEqual(expect.arrayContaining(['-c:v', 'libvpx']));
    expect(before(overlayFileArgs(overlay({ alpha: false }), 'o.mp4'))).not.toContain('-c:v');
    expect(before(overlayFileArgs(overlay({ codec: 'prores' }), 'o.mp4'))).not.toContain('-c:v');
  });

  it('cuts the stretch of a long file with seeking before the input', () => {
    const args = overlayFileArgs(overlay({ start: 12.5, duration: 6 }), 'o.mp4');
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(arg(args, '-ss')).toBe('12.500000');
    expect(arg(args, '-t')).toBe('6.000000');
  });
});
