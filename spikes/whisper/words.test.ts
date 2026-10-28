import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordsOf, type WhisperJson } from './words.ts';

/** Builds whisper.cpp-style JSON from [text, fromMs] tokens, 100 ms each. */
function json(tokens: [string, number][]): WhisperJson {
  return {
    result: { language: 'sr' },
    transcription: [{
      text: tokens.map(([t]) => t).join(''),
      offsets: { from: 0, to: 0 },
      tokens: tokens.map(([text, from]) => ({ text, offsets: { from, to: from + 100 }, p: 0.9, t_dtw: from / 10 })),
    }],
  };
}

test('sub-word tokens join into one word; trailing punctuation does not extend its end', () => {
  const words = wordsOf(json([[' Bos', 0], ['ni', 100], [',', 200], [' zdravo', 300]]));
  assert.deepEqual(words.map((w) => w.text), ['Bosni,', 'zdravo']);
  assert.equal(words[0].start, 0);
  assert.equal(words[0].end, 0.2);
  assert.equal(words[1].startDtw, 0.3);
});

test('an opening quote starts a new word even without a space after it', () => {
  const words = wordsOf(json([[' kaže', 0], [':', 100], [' "', 200], ['G', 300], ['ori', 400], ['"', 500]]));
  assert.deepEqual(words.map((w) => w.text), ['kaže:', '"Gori"']);
  assert.equal(words[1].start, 0.3);
});

test('punctuation before the first word is not lost or glued to the wrong word', () => {
  const words = wordsOf(json([['-', 0], [' Da', 100], [' ne', 200]]));
  assert.deepEqual(words.map((w) => w.text), ['-Da', 'ne']);
});

test('special tokens are skipped and Cyrillic becomes Latin', () => {
  const words = wordsOf(json([['[_BEG_]', 0], [' Љубав', 0], [' је', 100]]));
  assert.deepEqual(words.map((w) => w.text), ['Ljubav', 'je']);
});
