import { describe, expect, it } from 'vitest';
import { DEFAULT_CAPTION_STYLE } from './caption-style.ts';
import { newCaptionLayer } from './captions.ts';
import { clipFromWords } from './clips.ts';
import { DEFAULT_CHROMA_KEY } from './chroma-key.ts';
import { defaultParams } from './effects.ts';
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
// Off, as every clip from before format 13 comes out: the upgrades below compare with it.
sample.clips.push({ ...clipFromWords(sample.transcript!.segments[0]!.words, sample.source!, '0b6f2a52-9d0c-4f39-8f39-7f0e2c9b1a11'), evenLoudness: false });

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
    colorSpace: null,
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

  const lottieAsset = {
    id: '2c3d4e5f-6071-4829-93a4-b5c6d7e8f901',
    kind: 'lottie' as const,
    name: 'zvezdice.json',
    path: 'D:\\Animacije\\zvezdice.json',
    size: 8192,
    fingerprint: 'e'.repeat(64),
    width: 512,
    height: 512,
    frameRate: 29.97,
    frames: 90,
  };
  const withLottieAndEffect = (): Project => {
    const p = withVideo();
    p.assets.push(lottieAsset);
    p.clips[0]!.layers.push(
      {
        id: '3d4e5f60-7182-4930-a4b5-c6d7e8f90112',
        kind: 'lottie',
        assetId: lottieAsset.id,
        start: 0.4,
        end: 1.3,
        transform: [{ t: 0.4, value: { x: 0.5, y: 0.5, scale: 0.4, rotation: 0, opacity: 1 }, ease: 'cut' }],
        motion: DEFAULT_MOTION,
        speed: 1.5,
        loop: true,
      },
      {
        id: '4e5f6071-8293-4a41-b5c6-d7e8f9011223',
        kind: 'effect',
        effect: 'zoomPunch',
        start: 0.3,
        end: 1.1,
        intensity: [{ t: 0.3, value: 1, ease: 'cut' }, { t: 0.9, value: 0.5, ease: 'smooth' }],
        params: defaultParams('zoomPunch'),
      },
    );
    return p;
  };

  it('round-trips Lottie layers, their files and effects', () => {
    expect(parseProject(serializeProject(withLottieAndEffect()))).toEqual(withLottieAndEffect());
  });

  it('upgrades a format 6 file, which had no animations or effects, as it is', () => {
    expect(parseProject(JSON.stringify({ ...withVideo(), format: 6 }))).toEqual(withVideo());
  });

  it('upgrades a format 7 file, which had no speaker setting, to finding it out', () => {
    const { voices: _, ...old } = withLottieAndEffect();
    expect(parseProject(JSON.stringify({ ...old, format: 7 }))).toEqual(withLottieAndEffect());
  });

  it('keeps the number of people talking, within reason', () => {
    const two = { ...withVideo(), voices: { count: 2 as const, edits: [], picks: [] } };
    expect(parseProject(serializeProject(two))).toEqual(two);
    expect(code(() => parseProject(JSON.stringify({ ...two, voices: { ...two.voices, count: 0 } })))).toBe('invalid');
    expect(code(() => parseProject(JSON.stringify({ ...two, voices: { ...two.voices, count: 2.5 } })))).toBe('invalid');
  });

  it('upgrades a format 8 file, which had no corrections to the voices, keeping its count', () => {
    const old = { ...withVideo(), format: 8, voices: { count: 3 } };
    expect(parseProject(JSON.stringify(old)).voices).toEqual({ count: 3, edits: [], picks: [] });
  });

  it('upgrades a format 9 file, whose clips left nothing out', () => {
    const { skips: _, ...plain } = sample.clips[0]!;
    const old = { ...sample, format: 9, clips: [plain] };
    expect(parseProject(JSON.stringify(old)).clips[0]!.skips).toEqual([]);
  });

  describe('format 10 captions', () => {
    const key = (value: number, t = 0) => ({ t, value, ease: 'cut' as const });
    /** A format 10 file whose captions have these keyframes, and no track of their own for Split. */
    const upgraded = (y: ReturnType<typeof key>[]) => {
      const { splitY: _, ...old } = { ...newCaptionLayer(0, DEFAULT_CAPTION_STYLE), y };
      const clip = { ...sample.clips[0]!, layers: [...sample.clips[0]!.layers.filter((l) => l.kind !== 'caption'), old] };
      const layer = parseProject(JSON.stringify({ ...sample, format: 10, clips: [clip] })).clips[0]!.layers.find((l) => l.kind === 'caption');
      return layer as { y: unknown; splitY: unknown };
    };

    it('takes captions at the old default off the lower face in Split', () => {
      expect(upgraded([key(0.7, 3)])).toMatchObject({ y: [key(0.7, 3)], splitY: [key(0.5, 3)] });
    });

    it('keeps captions someone moved in that place in Split too', () => {
      expect(upgraded([key(0.3)]).splitY).toEqual([key(0.3)]);
    });

    it('keeps keyframed captions as they were in Split too', () => {
      const keys = [key(0.7), key(0.7, 1)];
      expect(upgraded(keys).splitY).toEqual(keys);
    });
  });

  it('keeps skips, and rejects them out of order or overlapping', () => {
    const withSkips = (skips: { start: number; end: number }[]) => JSON.stringify({ ...sample, clips: [{ ...sample.clips[0]!, skips }] });
    expect(parseProject(withSkips([{ start: 1, end: 2 }])).clips[0]!.skips).toEqual([{ start: 1, end: 2 }]);
    expect(code(() => parseProject(withSkips([{ start: 3, end: 4 }, { start: 1, end: 2 }])))).toBe('invalid');
    expect(code(() => parseProject(withSkips([{ start: 1, end: 3 }, { start: 2, end: 4 }])))).toBe('invalid');
    expect(code(() => parseProject(withSkips([{ start: 2, end: 2 }])))).toBe('invalid');
  });

  it('keeps corrections to the voices and picks, and rejects a pick outside the picture', () => {
    const edits = [
      { kind: 'name' as const, at: 3, name: 'Ana' },
      { kind: 'merge' as const, at: 3, into: 9 },
      { kind: 'turn' as const, start: 1, end: 2, as: 'new' as const },
      { kind: 'turn' as const, start: 4, end: 5, as: null },
      { kind: 'split' as const, at: 7 },
    ];
    const corrected = { ...withVideo(), voices: { count: 'auto' as const, edits, picks: [{ t: 4, x: 0.25, y: 0.4, size: 0.05 }] } };
    expect(parseProject(serializeProject(corrected))).toEqual(corrected);
    expect(code(() => parseProject(JSON.stringify({ ...corrected, voices: { ...corrected.voices, picks: [{ t: 4, x: 1.5, y: 0, size: 0.05 }] } })))).toBe('invalid');
  });

  it('rejects an effect setting out of its range, or one the effect does not have', () => {
    const tooMuch = withLottieAndEffect();
    const effect = tooMuch.clips[0]!.layers.at(-1)!;
    if (effect.kind === 'effect') effect.params['zoom'] = 5;
    expect(code(() => parseProject(JSON.stringify(tooMuch)))).toBe('invalid');
    const unknown = withLottieAndEffect();
    const other = unknown.clips[0]!.layers.at(-1)!;
    if (other.kind === 'effect') other.params['wobble'] = 1;
    expect(code(() => parseProject(JSON.stringify(unknown)))).toBe('invalid');
  });

  it('rejects an effect it does not know', () => {
    const p = withLottieAndEffect();
    const text = JSON.stringify(p).replace('"zoomPunch"', '"wobble"');
    expect(code(() => parseProject(text))).toBe('invalid');
  });

  it('rejects a video layer that is too loud', () => {
    const p = withVideo();
    const overlay = p.clips[0]!.layers.at(-1)!;
    if (overlay.kind === 'overlay') overlay.volume = 1.5;
    expect(code(() => parseProject(JSON.stringify(p)))).toBe('invalid');
  });

  describe('sound layers', () => {
    const music = { id: '3e0b8c1a-55f2-4b7e-8a51-0c6b1f7d2e44', kind: 'audio' as const, path: 'D:/Muzika/tema.mp3', name: 'tema.mp3', size: 4_000_000, fingerprint: 'c'.repeat(64), codec: 'mp3', duration: 95.2 };
    const sound = (source: { library: 'whoosh' } | { assetId: string }) => ({
      id: crypto.randomUUID(), kind: 'sound' as const, sound: source, start: 0.5, end: 1.2, offset: 0, volume: 0.8, fadeIn: 0.2, fadeOut: 1, loop: false, evenLoudness: false,
    });
    const withSounds = (...layers: ReturnType<typeof sound>[]): Project => ({
      ...sample,
      assets: [music],
      clips: [{ ...sample.clips[0]!, layers: [...sample.clips[0]!.layers, ...layers] }],
    });

    it('keeps a sound from the library and one from a file', () => {
      const p = withSounds(sound({ library: 'whoosh' }), sound({ assetId: music.id }));
      expect(parseProject(serializeProject(p))).toEqual(p);
    });

    it('rejects a sound whose file is not a sound file of the project', () => {
      expect(code(() => parseProject(JSON.stringify(withSounds(sound({ assetId: crypto.randomUUID() })))))).toBe('invalid');
      const p = withSounds(sound({ assetId: music.id }));
      expect(code(() => parseProject(JSON.stringify({ ...p, assets: [{ ...music, kind: 'image', width: 10, height: 10 }] })))).toBe('invalid');
    });

    it('rejects a sound the library does not have, or one too loud', () => {
      expect(code(() => parseProject(JSON.stringify(withSounds(sound({ library: 'whoosh' }))).replace('"whoosh"', '"airhorn"')))).toBe('invalid');
      const loud = withSounds({ ...sound({ library: 'whoosh' }), volume: 1.2 });
      expect(code(() => parseProject(JSON.stringify(loud)))).toBe('invalid');
    });

    it('upgrades a format 11 file, which had no sounds, as it is', () => {
      expect(parseProject(JSON.stringify({ ...sample, format: 11 }))).toEqual(sample);
    });

    it('upgrades a format 12 file with evening out off, so its clips and sounds sound as they did', () => {
      const p = withSounds(sound({ library: 'whoosh' }), sound({ assetId: music.id }));
      const old = JSON.parse(JSON.stringify({ ...p, format: 12 }), (k, v: unknown) => (k === 'evenLoudness' ? undefined : v)) as object;
      expect(JSON.stringify(old)).not.toContain('evenLoudness');
      expect(parseProject(JSON.stringify(old))).toEqual(p);
    });

    it('keeps whether a clip and a sound file are evened out', () => {
      const p = withSounds({ ...sound({ assetId: music.id }), evenLoudness: true });
      p.clips[0]!.evenLoudness = true;
      expect(parseProject(serializeProject(p))).toEqual(p);
    });
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

  it('gives a new clip captions, and its sound evened out', () => {
    expect(sample.clips[0]!.layers.map((l) => l.kind)).toEqual(['video', 'caption']);
    expect(clipFromWords(sample.transcript!.segments[0]!.words, sample.source!).evenLoudness).toBe(true);
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
