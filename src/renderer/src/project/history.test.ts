import { describe, expect, it } from 'vitest';
import { History } from './history.ts';

interface Doc {
  name: string;
  items: { id: number; x: number }[];
}

const start = (): Doc => ({ name: 'a', items: [{ id: 1, x: 0 }] });

describe('History', () => {
  it('undoes and redoes an edit', () => {
    const h = new History(start());
    h.edit('rename', (d) => {
      d.name = 'b';
    });
    expect(h.state.name).toBe('b');
    expect(h.undo()).toBe(true);
    expect(h.state).toEqual(start());
    expect(h.redo()).toBe(true);
    expect(h.state.name).toBe('b');
  });

  it('keeps the documents immutable', () => {
    const h = new History(start());
    const before = h.state;
    h.edit('move', (d) => {
      d.items[0]!.x = 5;
    });
    expect(before.items[0]!.x).toBe(0);
    expect(h.state).not.toBe(before);
  });

  it('skips edits that change nothing', () => {
    const h = new History(start());
    h.edit('noop', (d) => {
      d.name = 'a';
    });
    expect(h.undoLabel).toBeUndefined();
    expect(h.undo()).toBe(false);
  });

  it('drops the redo steps after a new edit', () => {
    const h = new History(start());
    h.edit('one', (d) => void (d.name = 'b'));
    h.undo();
    h.edit('two', (d) => void (d.name = 'c'));
    expect(h.redo()).toBe(false);
    expect(h.state.name).toBe('c');
  });

  it('makes a gesture one step', () => {
    const h = new History(start());
    h.beginGesture('drag');
    for (let x = 1; x <= 10; x++) h.edit('drag', (d) => void (d.items[0]!.x = x));
    h.edit('drag', (d) => void d.items.push({ id: 2, x: 0 }));
    h.endGesture();
    expect(h.undoLabel).toBe('drag');
    h.undo();
    expect(h.state).toEqual(start());
    h.redo();
    expect(h.state.items).toEqual([{ id: 1, x: 10 }, { id: 2, x: 0 }]);
  });

  it('closes an open gesture on undo', () => {
    const h = new History(start());
    h.edit('rename', (d) => void (d.name = 'b'));
    h.beginGesture('drag');
    h.edit('drag', (d) => void (d.items[0]!.x = 3));
    h.undo();
    expect(h.state.items[0]!.x).toBe(0);
    expect(h.state.name).toBe('b');
  });

  it('forgets the history on reset', () => {
    const h = new History(start());
    h.edit('rename', (d) => void (d.name = 'b'));
    h.reset({ name: 'z', items: [] });
    expect(h.undo()).toBe(false);
    expect(h.state.name).toBe('z');
  });

  it('labels the next undo and redo', () => {
    const h = new History(start());
    h.edit('rename', (d) => void (d.name = 'b'));
    h.edit('move', (d) => void (d.items[0]!.x = 1));
    expect(h.undoLabel).toBe('move');
    h.undo();
    expect(h.undoLabel).toBe('rename');
    expect(h.redoLabel).toBe('move');
  });
});
