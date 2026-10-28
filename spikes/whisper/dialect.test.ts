import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yatForms } from './dialect.ts';

test('counts only words that differ between ekavian and ijekavian', () => {
  assert.deepEqual(yatForms(['jedan', 'nije', 'dobije', 'jeste']), { ekavian: 0, ijekavian: 0 });
  assert.deepEqual(yatForms(['vreme', 'gde', 'pre', 'vrijeme', 'pobjedi']), { ekavian: 3, ijekavian: 2 });
});
