import { describe, expect, it } from 'vitest';
import { parseProbe, ProbeError, type FfprobeJson } from './probe.ts';

const video = { index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, r_frame_rate: '30/1', avg_frame_rate: '30/1' };
const audio = { index: 1, codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 };

const code = (json: FfprobeJson) => {
  try {
    parseProbe(json);
  } catch (e) {
    return e instanceof ProbeError ? e.code : String(e);
  }
  return 'no error';
};

describe('parseProbe', () => {
  it('reads a plain file', () => {
    expect(parseProbe({ streams: [video, audio], format: { duration: '3600.48' } })).toEqual({
      duration: 3600.48,
      video: { codec: 'h264', width: 1920, height: 1080, frameRate: [30, 1], variableFrameRate: false, colorSpace: null },
      audio: { codec: 'aac', sampleRate: 48000, channels: 2 },
    });
  });

  it('skips a cover image stream', () => {
    const cover = { index: 2, codec_type: 'video', codec_name: 'png', width: 480, height: 360, r_frame_rate: '90000/1', avg_frame_rate: '0/0', disposition: { attached_pic: 1 } };
    const r = parseProbe({ streams: [cover, { ...video, width: 480, height: 360, r_frame_rate: '24000/1001', avg_frame_rate: '24000/1001' }, audio], format: { duration: '70' } });
    expect(r.video).toMatchObject({ width: 480, frameRate: [24000, 1001], variableFrameRate: false });
  });

  it('spots a variable frame rate', () => {
    const vfr = { ...video, avg_frame_rate: '2745000/91447' };
    expect(parseProbe({ streams: [vfr], format: { duration: '67' } }).video.variableFrameRate).toBe(true);
  });

  it('keeps a known colour space and drops "unknown"', () => {
    expect(parseProbe({ streams: [{ ...video, color_space: 'bt709' }], format: { duration: '1' } }).video.colorSpace).toBe('bt709');
    expect(parseProbe({ streams: [{ ...video, color_space: 'unknown' }], format: { duration: '1' } }).video.colorSpace).toBeNull();
  });

  it('allows a file without audio', () => {
    expect(parseProbe({ streams: [video], format: { duration: '5' } }).audio).toBeNull();
  });

  it('refuses audio-only and broken files', () => {
    expect(code({ streams: [audio], format: { duration: '60' } })).toBe('no-video');
    expect(code({ streams: [{ ...video, r_frame_rate: '0/0', avg_frame_rate: '0/0' }], format: { duration: '60' } })).toBe('unreadable');
    expect(code({ streams: [video], format: {} })).toBe('unreadable');
  });
});
