import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cropAround, iou, nms, tiles, Tracker } from './boxes.ts';

test('iou of identical, disjoint and half-overlapping boxes', () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  assert.equal(iou(a, a), 1);
  assert.equal(iou(a, { x: 20, y: 0, w: 10, h: 10 }), 0);
  assert.equal(iou(a, { x: 5, y: 0, w: 10, h: 10 }), 50 / 150);
});

test('nms keeps the best of overlapping boxes', () => {
  const kept = nms([
    { x: 0, y: 0, w: 10, h: 10, score: 0.6 },
    { x: 1, y: 1, w: 10, h: 10, score: 0.9 },
    { x: 50, y: 50, w: 10, h: 10, score: 0.5 },
  ]);
  assert.deepEqual(kept.map((k) => k.score), [0.9, 0.5]);
});

test('nms drops a half-face box inside a full one', () => {
  const kept = nms([
    { x: 0, y: 0, w: 100, h: 100, score: 0.9 },
    { x: 0, y: 0, w: 40, h: 100, score: 0.8 },
  ]);
  assert.equal(kept.length, 1);
});

test('tiles cover the whole frame', () => {
  for (const [w, h] of [[1920, 1080], [1280, 720], [640, 480], [480, 360]]) {
    for (const rows of [2, 4]) {
      const t = tiles(w, h, rows);
      assert.equal(Math.max(...t.map((b) => b.x + b.w)), w, `${w}x${h}/${rows} width`);
      assert.equal(Math.max(...t.map((b) => b.y + b.h)), h, `${w}x${h}/${rows} height`);
      assert.equal(Math.min(...t.map((b) => b.x)), 0);
    }
  }
  assert.equal(tiles(1920, 1080).length, 6);
});

test('cropAround stays inside the frame', () => {
  const c = cropAround({ x: 0, y: 0, w: 100, h: 120 }, 1920, 1080);
  assert.deepEqual(c, { x: 0, y: 0, w: 240, h: 240 });
});

test('tracker keeps ids across frames and resets on cuts', () => {
  const t = new Tracker();
  const [a, b] = t.update([{ x: 0, y: 0, w: 10, h: 10 }, { x: 100, y: 0, w: 10, h: 10 }]);
  assert.deepEqual(t.update([{ x: 101, y: 1, w: 10, h: 10 }, { x: 1, y: 0, w: 10, h: 10 }]), [b, a]);
  t.cut();
  const [c] = t.update([{ x: 1, y: 0, w: 10, h: 10 }]);
  assert.notEqual(c, a);
});
