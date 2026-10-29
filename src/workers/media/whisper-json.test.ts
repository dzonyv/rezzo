import { describe, expect, it } from 'vitest';
import { segmentsOf, type WhisperJson } from './whisper-json.ts';

/** Token text as whisper.cpp leaves it after a Latin-1 read: one character per byte. */
const bytes = (s: string) => Buffer.from(s, 'utf8').toString('latin1');

/** whisper.cpp-style JSON: one segment per array of [text, fromMs] tokens, 100 ms each, DTW 50 ms later. */
function json(...segments: [string, number][][]): WhisperJson {
  return {
    transcription: segments.map((tokens) => ({
      text: tokens.map(([t]) => t).join(''),
      offsets: { from: 0, to: 0 },
      tokens: tokens.map(([text, from]) => ({ text: bytes(text), offsets: { from, to: from + 100 }, p: 0.9, t_dtw: (from + 50) / 10 })),
    })),
  };
}

const texts = (j: WhisperJson) => segmentsOf(j).map((s) => s.words.map((w) => w.text));

describe('segmentsOf', () => {
  it('joins sub-word tokens; trailing punctuation does not extend the word', () => {
    const [seg] = segmentsOf(json([[' Bos', 0], ['ni', 100], [',', 200], [' zdravo', 300]]));
    expect(seg!.words.map((w) => w.text)).toEqual(['Bosni,', 'zdravo']);
    expect(seg!.words[0]).toMatchObject({ start: 0.05, end: 0.2, p: 0.9 });
    expect(seg).toMatchObject({ start: 0.05, end: 0.4 });
  });

  it('uses the token start when DTW is off', () => {
    const j = json([[' da', 1000]]);
    j.transcription[0]!.tokens[0]!.t_dtw = -1;
    expect(segmentsOf(j)[0]!.words[0]!.start).toBe(1);
  });

  it('never lets a word end before it starts', () => {
    const j = json([[' da', 1000]]);
    j.transcription[0]!.tokens[0]!.t_dtw = 120; // DTW 1.2 s, after the token's end at 1.1 s
    expect(segmentsOf(j)[0]!.words[0]).toMatchObject({ start: 1.2, end: 1.2 });
  });

  it('starts a new word at an opening quote', () => {
    expect(texts(json([[' kaže', 0], [':', 100], [' "', 200], ['G', 300], ['ori', 400], ['"', 500]]))).toEqual([['kaže:', '"Gori"']]);
  });

  it('keeps leading punctuation with the next word', () => {
    expect(texts(json([['-', 0], [' Da', 100], [' ne', 200]]))).toEqual([['-Da', 'ne']]);
  });

  it('skips special tokens and transliterates Cyrillic', () => {
    expect(texts(json([['[_BEG_]', 0], [' Љубав', 0], [' је', 100]]))).toEqual([['Ljubav', 'je']]);
  });

  it('joins a letter split across two tokens', () => {
    const [b1, b2] = [...Buffer.from('č', 'utf8')].map((b) => String.fromCharCode(b));
    const j = json([[' to', 0], [' je', 200]]);
    j.transcription[0]!.tokens.splice(1, 0, { text: b1!, offsets: { from: 100, to: 150 }, p: 0.8, t_dtw: 10 }, { text: `${b2}ak`, offsets: { from: 150, to: 200 }, p: 0.7, t_dtw: 15 });
    expect(texts(j)).toEqual([['točak', 'je']]);
  });

  it('treats multi-byte punctuation as punctuation', () => {
    expect(texts(json([[' rekao', 0], [' „', 100], ['da', 200], ['“', 300]]))).toEqual([['rekao', '„da“']]);
  });

  it('keeps segments apart and drops empty ones', () => {
    expect(texts(json([[' Dobro', 0], [' veče.', 100]], [['[_TT_150]', 150]], [[' Kako', 300]]))).toEqual([
      ['Dobro', 'veče.'],
      ['Kako'],
    ]);
  });
});
