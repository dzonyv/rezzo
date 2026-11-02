import { describe, expect, it } from 'vitest';
import { clipFromWords } from './clips.ts';
import { DEFAULT_CHROMA_KEY } from './chroma-key.ts';
import { DEFAULT_MOTION } from './motion.ts';
import { DTW_START_SHIFT, MAX_CLIP_SECONDS, newProject, parseProject, PROJECT_FORMAT, ProjectFormatError, serializeProject, type Project } from './project.ts';

const sample: Project = {
  ...newProject('Epizoda 12', '6c1f0d6e-6a2b-4a7e-9d0e-3f1f5b2a9c11'),
  source: {
    path: 'D:\\Video\\epizoda-12.mp4',
    size: 1_234_567,
    fingerprint: 'a'.repeat(64),
    duration: 3600.5,
    video: { codec: 'h264', width: 1920, height: 1080, frameRate: [30, 1], variableFrameRate: false, colorSpace: null },
    audio: { codec: 'aac', sampleRate: 48000, channels: 2 },
  },
  transcript: {
    language: 'sr',
    model: 'large-v3-turbo-q5_0',
    createdAt: '2026-10-29T12:00:00.000Z',
    startShift: DTW_START_SHIFT,
    segments: [{ start: 0.2, end: 1.4, words: [{ text: 'Dobro', start: 0.2, end: 0.6, p: 0.98 }, { text: 'veče.', start: 0.62, end: 1.4, p: 0.91 }] }],
  },
  clips: [],
};
sample.clips.push(clipFromWords(sample.transcript!.segments[0]!.words, sample.source!, '0b6f2a52-9d0c-4f39-8f39-7f0e2c9b1a11'));

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ProjectFormatError ? e.code : String(e);
  }
  return 'no error';
};

describe('project files', () => {
  it('round-trips', () => {
    expect(parseProject(serializeProject(sample))).toEqual(sample);
  });

  it('starts empty', () => {
    const p = newProject('x');
    expect(p).toMatchObject({ format: PROJECT_FORMAT, name: 'x', source: null, transcript: null, clips: [] });
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects files that are not projects', () => {
    expect(code(() => parseProject('not json'))).toBe('not-json');
    expect(code(() => parseProject('{"hello": 1}'))).toBe('not-a-project');
    expect(code(() => parseProject('[]'))).toBe('not-a-project');
  });

  it('rejects files from a newer version of the app', () => {
    expect(code(() => parseProject(JSON.stringify({ ...sample, format: PROJECT_FORMAT + 1 })))).toBe('too-new');
  });

  /**
   * The sample as format 2 wrote it: DTW starts 100 ms later, no startShift,
   * and the clip made from those late starts, so it starts 100 ms later too.
   */
  const format2 = () => {
    const { startShift: _, ...transcript } = sample.transcript!;
    const late = <T extends { start: number }>(w: T) => ({ ...w, start: Math.round((w.start - DTW_START_SHIFT) * 1000) / 1000 });
    const segments = transcript.segments.map((s) => ({ ...late(s), words: s.words.map(late) }));
    return { ...sample, format: 2, transcript: { ...transcript, segments }, clips: sample.clips.map(late) };
  };

  it('upgrades a format 1 file, which had no clips', () => {
    const { clips: _, ...old } = format2();
    expect(parseProject(JSON.stringify({ ...old, format: 1 }))).toEqual({ ...sample, clips: [] });
  });

  it('upgrades a format 2 file by moving word starts earlier, and clip starts with them', () => {
    expect(format2().clips[0]!.start).toBeCloseTo(0.2);
    expect(parseProject(JSON.stringify(format2()))).toEqual(sample);
  });

  it('leaves a clip alone when an earlier start would make it too long', () => {
    const old = format2();
    old.clips = [{ ...old.clips[0]!, start: 10, end: 10 + MAX_CLIP_SECONDS }];
    expect(parseProject(JSON.stringify(old)).clips[0]!.start).toBe(10);
  });

  it('upgrades a format 2 file without a transcript', () => {
    expect(parseProject(JSON.stringify({ ...format2(), transcript: null }))).toEqual({ ...sample, transcript: null });
  });

  it('upgrades a format 3 file, which had no captions, as it is', () => {
    const old = { ...sample, format: 3, clips: sample.clips.map((c) => ({ ...c, layers: c.layers.filter((l) => l.kind === 'video') })) };
    expect(parseProject(JSON.stringify(old))).toEqual({ ...old, format: PROJECT_FORMAT });
  });

  it('upgrades a format 4 file, which had no layers over the picture, with no assets', () => {
    const { assets: _, ...old } = sample;
    expect(parseProject(JSON.stringify({ ...old, format: 4 }))).toEqual(sample);
  });

  const asset = {
    id: '5d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a',
    kind: 'image' as const,
    name: 'logo.png',
    path: 'D:\\Slike\\logo.png',
    size: 2048,
    fingerprint: 'c'.repeat(64),
    width: 400,
    height: 200,
  };
  const withImage = (assetId = asset.id): Project => {
    const clip = sample.clips[0]!;
    const image = {
      id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
      kind: 'image' as const,
      assetId,
      start: 0.3,
      end: 1.2,
      transform: [{ t: 0.3, value: { x: 0.5, y: 0.3, scale: 0.6, rotation: 0, opacity: 1 }, ease: 'cut' as const }],
      motion: DEFAULT_MOTION,
      key: null,
    };
    return { ...sample, assets: [asset], clips: [{ ...clip, layers: [...clip.layers, image] }] };
  };

  const videoAsset = {
    id: '7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918',
    kind: 'video' as const,
    name: 'konfete.webm',
    path: 'D:\\Video\\konfete.webm',
    size: 4096,
    fingerprint: 'd'.repeat(64),
    codec: 'vp9',
    width: 1080,
    height: 1920,
    duration: 3.5,
    frameRate: [30, 1] as [number, number],
    alpha: true,
    hasAudio: false,
  };
  const withVideo = (assetId = videoAsset.id): Project => {
    const p = withImage();
    const overlay = {
      id: '1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9',
      kind: 'overlay' as const,
      assetId,
      start: 0.5,
      end: 1.4,
      transform: [{ t: 0.5, value: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 }, ease: 'cut' as const }],
      motion: DEFAULT_MOTION,
      key: { ...DEFAULT_CHROMA_KEY },
      offset: 1.25,
      volume: 0.8,
      loop: true,
    };
    p.assets.push(videoAsset);
    p.clips[0]!.layers.push(overlay);
    return p;
  };

  it('round-trips image layers and their files', () => {
    expect(parseProject(serializeProject(withImage()))).toEqual(withImage());
  });

  it('upgrades a format 5 file, whose images had no green screen', () => {
    const p = withImage();
    const old = { ...p, format: 5, clips: p.clips.map((c) => ({ ...c, layers: c.layers.map((l) => (l.kind === 'image' ? { ...l, key: undefined } : l)) })) };
    expect(parseProject(JSON.stringify(old))).toEqual(p);
  });

  it('round-trips video layers and their files', () => {
    expect(parseProject(serializeProject(withVideo()))).toEqual(withVideo());
  });

  it('rejects a layer whose file is of the wrong kind', () => {
    expect(code(() => parseProject(JSON.stringify(withVideo(asset.id))))).toBe('invalid');
  });

  it('rejects a video layer that is too loud', () => {
    const p = withVideo();
    const overlay = p.clips[0]!.layers.at(-1)!;
    if (overlay.kind === 'overlay') overlay.volume = 1.5;
    expect(code(() => parseProject(JSON.stringify(p)))).toBe('invalid');
  });

  it('rejects a layer whose file is not in the project', () => {
    expect(code(() => parseProject(JSON.stringify(withImage(crypto.randomUUID()))))).toBe('invalid');
  });

  it('rejects a clip whose source video is not the bottom layer', () => {
    const p = withImage();
    p.clips[0]!.layers.reverse();
    expect(code(() => parseProject(JSON.stringify(p)))).toBe('invalid');
  });

  it('rejects a layer that ends before it starts', () => {
    const p = withImage();
    const image = p.clips[0]!.layers.at(-1)!;
    if (image.kind === 'image') image.end = image.start;
    expect(code(() => parseProject(JSON.stringify(p)))).toBe('invalid');
  });

  it('gives a new clip captions', () => {
    expect(sample.clips[0]!.layers.map((l) => l.kind)).toEqual(['video', 'caption']);
  });

  it('rejects a caption style it does not know', () => {
    const clip = sample.clips[0]!;
    const layers = clip.layers.map((l) => (l.kind === 'caption' ? { ...l, style: { ...l.style, mode: 'karaoke' } } : l));
    expect(code(() => parseProject(JSON.stringify({ ...sample, clips: [{ ...clip, layers }] })))).toBe('invalid');
  });

  it('rejects keyframes out of order', () => {
    const clip = sample.clips[0]!;
    const layer = clip.layers[0]!;
    const layout = [{ t: 2, value: 'follow', ease: 'cut' }, { t: 1, value: 'split', ease: 'cut' }];
    const bad = { ...sample, clips: [{ ...clip, layers: [{ ...layer, layout }] }] };
    expect(code(() => parseProject(JSON.stringify(bad)))).toBe('invalid');
  });

  it('rejects damaged projects', () => {
    const bad = { ...sample, transcript: { ...sample.transcript!, language: 'de' } };
    expect(code(() => parseProject(JSON.stringify(bad)))).toBe('invalid');
  });

  it('refuses to write an invalid project', () => {
    expect(() => serializeProject({ ...sample, name: 3 } as unknown as Project)).toThrow();
  });
});
