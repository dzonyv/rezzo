import { test } from 'node:test';
import assert from 'node:assert/strict';
import { align, normalize, stripDiacritics, stripSpeakerTags } from './metrics.ts';

test('speaker tags at line starts are not words', () => {
  assert.deepEqual(normalize(stripSpeakerTags('M:Dobar dan.\nA: Kako ste?\nNije: ovo')), ['dobar', 'dan', 'kako', 'ste', 'nije', 'ovo']);
});

test('normalize lowercases, drops punctuation and transliterates', () => {
  assert.deepEqual(normalize('Ćao, БРАТЕ! Šta ima?'), ['ćao', 'brate', 'šta', 'ima']);
});

test('align counts substitutions, deletions and insertions', () => {
  const ops = align(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'e', 'd']);
  assert.deepEqual(ops.map((o) => o.kind), ['ok', 'sub', 'ok', 'ins', 'ok']);
  assert.deepEqual(align(['a', 'b'], ['b']).map((o) => o.kind), ['del', 'ok']);
});

test('stripDiacritics treats đ, dj and d alike', () => {
  assert.equal(stripDiacritics('đak'), stripDiacritics('djak'));
  assert.equal(stripDiacritics('đak'), stripDiacritics('dak'));
  assert.equal(stripDiacritics('ćevapčići'), 'cevapcici');
});
