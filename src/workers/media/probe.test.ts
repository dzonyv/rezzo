import { describe, expect, it } from 'vitest';
import { alphaDecoder, hasAlphaChannel, parseProbe, parseVideoInfo, ProbeError, streamAlpha, type FfprobeJson } from './probe.ts';

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

describe('video layer files', () => {
  it('reads size, length, rate and sound', () => {
    expect(parseVideoInfo({ streams: [video, audio], format: { duration: '4.5' } }, false)).toEqual({
      codec: 'h264',
      width: 1920,
      height: 1080,
      duration: 4.5,
      frameRate: [30, 1],
      alpha: false,
      hasAudio: true,
    });
    expect(parseVideoInfo({ streams: [video], format: { duration: '4.5' } }, true)).toMatchObject({ alpha: true, hasAudio: false });
  });

  it('turns the size of a video stored sideways', () => {
    const phone = { ...video, side_data_list: [{ rotation: -90 }] };
    expect(parseVideoInfo({ streams: [phone], format: { duration: '2' } }, false)).toMatchObject({ width: 1080, height: 1920 });
    const upsideDown = { ...video, side_data_list: [{ rotation: 180 }] };
    expect(parseVideoInfo({ streams: [upsideDown], format: { duration: '2' } }, false)).toMatchObject({ width: 1920, height: 1080 });
  });

  it('sees alpha in the stream when the stream says so, and only then', () => {
    // WebM: yuv420p on the stream, alpha in a tag.
    expect(streamAlpha({ pix_fmt: 'yuv420p', tags: { alpha_mode: '1' } })).toBe(true);
    expect(streamAlpha({ pix_fmt: 'yuva444p12le' })).toBe(true);
    expect(streamAlpha({ pix_fmt: 'argb' })).toBe(true);
    // HEVC with alpha says yuv420p here; only a decoded frame can tell.
    expect(streamAlpha({ pix_fmt: 'yuv420p' })).toBeNull();
  });

  it('knows which pixel formats carry alpha', () => {
    for (const f of ['yuva420p', 'rgba', 'bgra', 'argb', 'abgr', 'gbrap', 'ya8', 'rgba64le']) expect(hasAlphaChannel(f), f).toBe(true);
    for (const f of ['yuv420p', 'yuvj420p', 'rgb24', 'gbrp', 'gray', 'pal8', undefined]) expect(hasAlphaChannel(f), String(f)).toBe(false);
  });

  it('decodes VP8 and VP9 with libvpx, which keeps the alpha', () => {
    expect(alphaDecoder('vp9')).toBe('libvpx-vp9');
    expect(alphaDecoder('vp8')).toBe('libvpx');
    expect(alphaDecoder('hevc')).toBeNull();
  });
});
