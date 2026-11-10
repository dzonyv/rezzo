import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newProject, type Project } from '../../../shared/project.ts';

vi.mock('../export/state.ts', () => ({ isExporting: () => false, cancelExport: async () => {} }));
vi.mock('./transcription.ts', () => ({ cancelTranscription: () => {} }));

const { openProject, save, settleUnsaved } = await import('./actions.ts');
const { promptStore } = await import('../ui/prompts.ts');
const { isDirty, projectStore } = await import('./store.ts');

/** The page's side of the bridge to the main process, with a disk of project files behind it. */
const disk = new Map<string, Project>();
const invoke = vi.fn();
/** A stand-in for the focused field: leaving it applies its value, like the word editor. */
class HTMLElement {
  private readonly onBlur: () => void;
  constructor(onBlur: () => void) {
    this.onBlur = onBlur;
  }
  blur() {
    this.onBlur();
  }
}
const doc: { activeElement: HTMLElement | null } = { activeElement: null };
vi.stubGlobal('window', { rezzo: { invoke } });
vi.stubGlobal('document', doc);
vi.stubGlobal('HTMLElement', HTMLElement);

const A = 'C:\\a.rezzo';
const B = 'C:\\b.rezzo';
const state = () => projectStore.getState();
const rename = (name: string) => state().edit('history.rename', (d) => void (d.name = name));

/** Answers the unsaved-changes question as soon as it's asked. */
function answerUnsaved(answer: 'save' | 'discard' | 'cancel'): void {
  const stop = promptStore.subscribe((s) => {
    if (!s.unsaved) return;
    stop();
    s.unsaved.answer(answer);
  });
}

/** Makes the next call to the main process wait; returns what lets it finish. */
function holdNextCall(): (result: unknown) => void {
  let finish: (result: unknown) => void = () => {};
  invoke.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  return (result) => finish(result);
}

beforeEach(() => {
  disk.clear();
  doc.activeElement = null;
  promptStore.setState({ unsaved: null, confirmation: null, notices: [] });
  state().close();
  invoke.mockReset();
  invoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
    if (channel === 'project:save') {
      disk.set(args[1] as string, args[0] as Project);
      return { ok: true, path: args[1] };
    }
    if (channel === 'project:open') return { ok: true, path: args[0], project: disk.get(args[0] as string) };
    return undefined;
  });
});

describe('save', () => {
  it('leaves a project opened meanwhile with its own file', async () => {
    const b = newProject('b');
    state().load(newProject('a'), A);
    rename('a2');
    const finish = holdNextCall();
    const saving = save(false);
    await Promise.resolve();
    state().load(b, B);
    finish({ ok: true, path: A });
    expect(await saving).toBe(true);
    expect(state().project).toBe(b);
    expect(state().filePath).toBe(B);
    expect(isDirty(state())).toBe(false);
  });

  it('keeps edits made during the save unsaved', async () => {
    state().load(newProject('a'), A);
    rename('a2');
    const finish = holdNextCall();
    const saving = save(false);
    await Promise.resolve();
    rename('a3');
    finish({ ok: true, path: A });
    await saving;
    expect(isDirty(state())).toBe(true);
  });

  it('runs one save at a time, the second with the project as it is by then', async () => {
    state().load(newProject('a'), A);
    rename('a2');
    const finish = holdNextCall();
    const first = save(false);
    const second = save(false);
    await Promise.resolve();
    rename('a3');
    expect(invoke).toHaveBeenCalledTimes(1);
    finish({ ok: true, path: A });
    await Promise.all([first, second]);
    expect(disk.get(A)!.name).toBe('a3');
    expect(isDirty(state())).toBe(false);
  });
});

describe('opening the project that is already open', () => {
  it('loads what was just saved, not what was read before the save', async () => {
    const a = newProject('a');
    disk.set(A, a);
    state().load(a, A);
    rename('new work');
    answerUnsaved('save');
    await openProject(A);
    expect(disk.get(A)!.name).toBe('new work');
    expect(state().project!.name).toBe('new work');
    expect(isDirty(state())).toBe(false);
  });

  it('loads the file as it is when the changes are dropped', async () => {
    const a = newProject('a');
    disk.set(A, a);
    state().load(a, A);
    rename('dropped');
    answerUnsaved('discard');
    await openProject(A);
    expect(state().project!.name).toBe('a');
    expect(invoke.mock.calls.filter(([channel]) => channel === 'project:open')).toHaveLength(1);
  });
});

describe('settling unsaved work', () => {
  it('takes the value of the field being typed in before deciding nothing changed', async () => {
    state().load(newProject('a'), A);
    doc.activeElement = new HTMLElement(() => rename('typed'));
    answerUnsaved('cancel');
    expect(await settleUnsaved()).toBe(false);
    expect(state().project!.name).toBe('typed');
  });
});
