import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cyrillicRatio, toLatin } from './transliterate.ts';

test('maps every letter of the alphabet', () => {
  assert.equal(
    toLatin('абвгдђежзијклљмнњопрстћуфхцчџш'),
    'abvgdđežzijklljmnnjoprstćufhcčdžš',
  );
  assert.equal(
    toLatin('АБВГДЂЕЖЗИЈКЛМНОПРСТЋУФХЦЧШ'),
    'ABVGDĐEŽZIJKLMNOPRSTĆUFHCČŠ',
  );
});

test('digraphs are title case at the start of a word', () => {
  assert.equal(toLatin('Љубав'), 'Ljubav');
  assert.equal(toLatin('Њива'), 'Njiva');
  assert.equal(toLatin('Џеп'), 'Džep');
});

test('digraphs are all caps inside all-caps words', () => {
  assert.equal(toLatin('ЉУБАВ'), 'LJUBAV');
  assert.equal(toLatin('КОЊ'), 'KONJ');
  assert.equal(toLatin('ЏЕП!'), 'DŽEP!');
});

test('a lone uppercase digraph letter is title case', () => {
  assert.equal(toLatin('Љ'), 'Lj');
  assert.equal(toLatin('слово Џ.'), 'slovo Dž.');
});

test('leaves Latin, digits and punctuation alone', () => {
  assert.equal(toLatin('Ćao, šta ima? 2 puta.'), 'Ćao, šta ima? 2 puta.');
  assert.equal(toLatin('Он је рекао: "OK, 100%".'), 'On je rekao: "OK, 100%".');
});

test('normalizes decomposed diacritics to single characters', () => {
  const decomposed = 'čevapi'; // c + combining caron
  assert.equal(toLatin(decomposed), 'čevapi');
  assert.equal(toLatin(decomposed).length, 6);
});

test('cyrillicRatio counts only letters', () => {
  assert.equal(cyrillicRatio('Здраво'), 1);
  assert.equal(cyrillicRatio('Zdravo'), 0);
  assert.equal(cyrillicRatio('Здраво, zdravo!'), 0.5);
  assert.equal(cyrillicRatio('123 ...'), 0);
});
