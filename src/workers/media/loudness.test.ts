import { describe, expect, it } from 'vitest';
import { loudnessArgs } from './loudness.ts';

const arg = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe('loudness measuring', () => {
  it('measures all of a file, made stereo at 48 kHz as the mix takes it, and writes nothing', () => {
    const args = loudnessArgs({ file: 'D:\\Muzika\\tema.mp3', pieces: null });
    expect(arg(args, '-i')).toBe('D:\\Muzika\\tema.mp3');
    expect(arg(args, '-filter_complex')).toBe('[0:a:0]aformat=sample_rates=48000:channel_layouts=stereo,ebur128=peak=true:framelog=quiet[m]');
    expect(args.slice(-4)).toEqual(['[m]', '-f', 'null', '-']);
  });

  it('measures only the stretches a clip plays, one after another', () => {
    const graph = arg(loudnessArgs({ file: 'w.mp4', pieces: [{ start: 0, duration: 3 }, { start: 4.5, duration: 2 }] }), '-filter_complex')!;
    expect(graph).toContain('[0:a:0]atrim=start=0.000000:end=3.000000,asetpts=PTS-STARTPTS,');
    expect(graph).toContain('[0:a:0]atrim=start=4.500000:end=6.500000,asetpts=PTS-STARTPTS,');
    expect(graph).toContain('[p0][p1]concat=n=2:v=0:a=1,ebur128=peak=true:framelog=quiet[m]');
  });
});
