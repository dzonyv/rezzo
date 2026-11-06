import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClipAnalysis } from '../../../shared/analysis.ts';
import type { WorkingFile } from '../render/clip-player.ts';

const invoke = vi.hoisted(() => {
  const invoke = vi.fn();
  // The store reads the page's API as it loads, and this config has no page.
  Object.assign(globalThis, { window: { rezzo: { invoke, on: () => () => {} } } });
  return invoke;
});

const analyseClip = vi.hoisted(() => vi.fn());
vi.mock('./analyse.ts', () => ({ analyseClip }));

const { analyse, analysisStore, retryAnalysis, stopAnalysis } = await import('./store.ts');

const FILE = { url: 'rezzo-media://working/a' } as WorkingFile;
const RESULT = { shots: [] } as unknown as ClipAnalysis;

/** Answers `analysis:load` with nothing and `analysis:save` with `save`. */
function answer(save: () => Promise<void>): void {
  invoke.mockImplementation((channel: string) => (channel === 'analysis:save' ? save() : Promise.resolve(null)));
}

beforeEach(() => {
  stopAnalysis();
  vi.clearAllMocks();
  analyseClip.mockResolvedValue(RESULT);
});

describe('analyse', () => {
  it('keeps a finished analysis when it can\'t be saved', async () => {
    answer(() => Promise.reject(new Error('disk full')));
    await analyse(FILE);
    expect(analysisStore.getState()).toMatchObject({ status: 'ready', analysis: RESULT, detail: null });
  });

  it('says why it failed, and tries the same file again on request', async () => {
    answer(() => Promise.resolve());
    analyseClip.mockRejectedValueOnce(new Error('the worker stopped'));
    await analyse(FILE);
    expect(analysisStore.getState()).toMatchObject({ status: 'failed', analysis: null, detail: 'the worker stopped' });

    retryAnalysis();
    await vi.waitFor(() => expect(analysisStore.getState().status).toBe('ready'));
    expect(analyseClip).toHaveBeenCalledTimes(2);
    expect(analyseClip.mock.calls[1]![0]).toBe(FILE);
  });

  it('has nothing to try again once the clip is closed', () => {
    stopAnalysis();
    retryAnalysis();
    expect(analyseClip).not.toHaveBeenCalled();
  });
});
