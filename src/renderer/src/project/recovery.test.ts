import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newProject } from '../../../shared/project.ts';
import { startRecoveryCopies } from './recovery.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('recovery copies', () => {
  it('writes unsaved work once, and again only after it changes', async () => {
    let project = newProject('a');
    const write = vi.fn(() => Promise.resolve());
    const stop = startRecoveryCopies({ unsaved: () => ({ project, filePath: null }), write, onFailing: vi.fn() }, 1000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(write).toHaveBeenCalledTimes(1);
    project = { ...project, name: 'b' };
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(2);
    stop();
  });

  it('tries again when a copy could not be written, and says so once', async () => {
    const project = newProject('a');
    const write = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error('disk full')).mockRejectedValueOnce(new Error('disk full')).mockResolvedValue();
    const onFailing = vi.fn();
    const stop = startRecoveryCopies({ unsaved: () => ({ project, filePath: null }), write, onFailing }, 1000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(write).toHaveBeenCalledTimes(2);
    expect(onFailing).toHaveBeenCalledExactlyOnceWith('disk full');
    await vi.advanceTimersByTimeAsync(2000);
    // The third try worked; nothing more to write.
    expect(write).toHaveBeenCalledTimes(3);
    stop();
  });

  it('does not start a second write while one is still running', async () => {
    let project = newProject('a');
    let finish = () => {};
    const write = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const stop = startRecoveryCopies({ unsaved: () => ({ project, filePath: null }), write, onFailing: vi.fn() }, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    project = { ...project, name: 'b' };
    await vi.advanceTimersByTimeAsync(2000);
    expect(write).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(2);
    stop();
  });
});
