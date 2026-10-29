import { describe, expect, it } from 'vitest';
import type { WorkingFileRequest } from '../../shared/worker-api.ts';
import { workingFileArgs } from './working.ts';

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
