import { describe, expect, it } from 'vitest';
import { newProject } from '../../../shared/project.ts';
import { createProjectStore, isDirty } from './store.ts';

describe('project store', () => {
  it('tracks unsaved changes', () => {
    const store = createProjectStore();
    const p = newProject('a');
    store.getState().load(p, 'C:\\a.rezzo');
    expect(isDirty(store.getState())).toBe(false);

    store.getState().edit('history.rename', (d) => void (d.name = 'b'));
    expect(isDirty(store.getState())).toBe(true);
    expect(store.getState().undoLabel).toBe('history.rename');

    store.getState().markSaved(store.getState().project!, 'C:\\a.rezzo');
    expect(isDirty(store.getState())).toBe(false);
  });

  it('treats a new project as unsaved only after an edit', () => {
    const store = createProjectStore();
    store.getState().load(newProject('a'), null);
    // Nothing to lose yet, but there is no file either.
    expect(store.getState().filePath).toBeNull();
    expect(isDirty(store.getState())).toBe(true);
  });

  it('replace() clears undo', () => {
    const store = createProjectStore();
    store.getState().load(newProject('a'), 'C:\\a.rezzo');
    store.getState().edit('history.rename', (d) => void (d.name = 'b'));
    store.getState().replace((d) => void (d.name = 'c'));
    expect(store.getState().project!.name).toBe('c');
    expect(store.getState().undoLabel).toBeUndefined();
    store.getState().undo();
    expect(store.getState().project!.name).toBe('c');
  });

  it('closes', () => {
    const store = createProjectStore();
    store.getState().load(newProject('a'), null);
    store.getState().close();
    expect(store.getState().project).toBeNull();
    expect(isDirty(store.getState())).toBe(false);
  });
});
