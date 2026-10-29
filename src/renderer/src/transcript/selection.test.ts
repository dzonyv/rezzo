import { beforeEach, describe, expect, it } from 'vitest';
import { clearSelection, enterWord, pressWord, release, selectedRange, selectionStore } from './selection.ts';

const range = () => selectedRange(selectionStore.getState());

describe('word selection', () => {
  beforeEach(clearSelection);

  it('selects by dragging, in either direction', () => {
    pressWord(5, false);
    enterWord(6);
    enterWord(9);
    expect(release()).toBe('select');
    expect(range()).toEqual({ first: 5, last: 9 });

    pressWord(5, false);
    enterWord(2);
    release();
    expect(range()).toEqual({ first: 2, last: 5 });
  });

  it('treats a press without moving as a click', () => {
    pressWord(3, false);
    expect(release()).toBe('click');
    expect(range()).toBeNull();
  });

  it('counts dragging away and back as a selection of one word', () => {
    pressWord(3, false);
    enterWord(4);
    enterWord(3);
    expect(release()).toBe('select');
    expect(range()).toEqual({ first: 3, last: 3 });
  });

  it('extends with Shift+click', () => {
    pressWord(10, false);
    enterWord(12);
    release();
    pressWord(20, true);
    expect(release()).toBe('select');
    expect(range()).toEqual({ first: 10, last: 20 });
  });

  it('ignores words passed over when not dragging', () => {
    enterWord(4);
    expect(range()).toBeNull();
    expect(release()).toBeNull();
  });
});
