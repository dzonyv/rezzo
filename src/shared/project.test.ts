import { describe, expect, it } from 'vitest';
import { clipFromWords } from './clips.ts';
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
