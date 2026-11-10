import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newProject, type Project } from '../../../shared/project.ts';
import { startRecoveryCopies, type RecoveryCopies } from './recovery.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Recovery copies of `open()`, the unsaved project (null: nothing unsaved), every second. */
function start(open: () => Project | null, write: RecoveryCopies['write']) {
  const discard = vi.fn(() => Promise.resolve());
  const onFailing = vi.fn();
  const stop = startRecoveryCopies(
    {
      unsaved() {
        const project = open();
        return project && { project, filePath: null };
      },
      write,
      discard,
      onFailing,
    },
    1000,
  );
  return { discard, onFailing, stop };
}

describe('recovery copies', () => {
  it('writes unsaved work once, and again only after it changes', async () => {
    let project = newProject('a');
    const write = vi.fn(() => Promise.resolve());
    const { stop, discard } = start(() => project, write);
    await vi.advanceTimersByTimeAsync(3000);
    expect(write).toHaveBeenCalledTimes(1);
    project = { ...project, name: 'b' };
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(2);
    expect(discard).not.toHaveBeenCalled();
    stop();
  });

  it('tries again when a copy could not be written, and says so once', async () => {
    const project = newProject('a');
    const write = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error('disk full')).mockRejectedValueOnce(new Error('disk full')).mockResolvedValue();
    const { stop, onFailing } = start(() => project, write);
    await vi.advanceTimersByTimeAsync(2000);
    expect(write).toHaveBeenCalledTimes(2);
    expect(onFailing).toHaveBeenCalledExactlyOnceWith('disk full');
    await vi.advanceTimersByTimeAsync(2000);
    // The third try worked; nothing more to write.
    expect(write).toHaveBeenCalledTimes(3);
    stop();
  });

  it('says so again for another project', async () => {
    let project = newProject('a');
    const { stop, onFailing } = start(() => project, vi.fn(() => Promise.reject(new Error('disk full'))));
    await vi.advanceTimersByTimeAsync(2000);
    expect(onFailing).toHaveBeenCalledTimes(1);
    project = newProject('b');
    await vi.advanceTimersByTimeAsync(2000);
    expect(onFailing).toHaveBeenCalledTimes(2);
    stop();
  });

  it('does not start a second write while one is still running', async () => {
    let project = newProject('a');
    let finish = () => {};
    const write = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { stop } = start(() => project, write);
    await vi.advanceTimersByTimeAsync(1000);
    project = { ...project, name: 'b' };
    await vi.advanceTimersByTimeAsync(2000);
    expect(write).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(2);
    stop();
  });

  it('removes a copy that was still being written when the project was saved', async () => {
    const project = newProject('a');
    let open: Project | null = project;
    let finish = () => {};
    const { stop, discard } = start(() => open, () => new Promise<void>((resolve) => (finish = resolve)));
    await vi.advanceTimersByTimeAsync(1000);
    // Saved: nothing unsaved any more, and the save has already cleaned up.
    open = null;
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(discard).toHaveBeenCalledExactlyOnceWith(project.id);
    stop();
  });
});
