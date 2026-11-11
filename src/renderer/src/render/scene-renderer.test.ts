import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoAsset } from '../../../shared/assets.ts';
import { defaultVideoLayer } from '../../../shared/framing.ts';
import { DEFAULT_MOTION } from '../../../shared/motion.ts';
import type { Clip, OverlayLayer } from '../../../shared/project.ts';

// Only the video layers' files are looked at here; the rest of the scene needs a page.
vi.mock('./captions.ts', () => ({ CaptionPainter: class {}, loadCaptionScene: async () => null }));
vi.mock('./images.ts', () => ({ loadImage: async () => ({}) }));
vi.mock('./lottie.ts', () => ({ loadLottie: async () => ({}), LottieLayers: class {} }));
vi.mock('./layer-frames.ts', () => ({ LayerFrames: class {} }));
vi.mock('../project/assets.ts', () => ({ markMissing() {} }));

const invoke = vi.fn();
vi.stubGlobal('window', { rezzo: { invoke, on: () => () => {} } });

const { loadOverlayFiles } = await import('./scene-renderer.ts');

const asset: VideoAsset = {
  id: '6a3f0e8e-2b1c-4c58-9d55-0d6f6a1d2c01',
  kind: 'video',
  path: 'D:\\Video\\dugi.mp4',
  name: 'dugi.mp4',
  size: 1,
  fingerprint: 'b'.repeat(64),
  codec: 'h264',
  width: 1280,
  height: 720,
  duration: 600,
  frameRate: [30, 1],
  colorSpace: null,
  alpha: false,
  hasAudio: false,
};
const layer: OverlayLayer = {
  id: '6a3f0e8e-2b1c-4c58-9d55-0d6f6a1d2c02',
  kind: 'overlay',
  assetId: asset.id,
  start: 0,
  end: 10,
  transform: [{ t: 0, value: { x: 0.5, y: 0.5, scale: 0.5, rotation: 0, opacity: 1 }, ease: 'cut' }],
  motion: DEFAULT_MOTION,
  key: null,
  offset: 0,
  volume: 0,
  loop: false,
};
const clip: Clip = { id: '6a3f0e8e-2b1c-4c58-9d55-0d6f6a1d2c03', name: 'x', start: 0, end: 10, skips: [], evenLoudness: false, layers: [defaultVideoLayer(0), layer] };

beforeEach(() => invoke.mockReset());

describe('loadOverlayFiles', () => {
  it("stops a video layer's conversion when the export is cancelled, and gives up at once", async () => {
    // The main process: a conversion that runs until its request is cancelled.
    const answers = new Map<string, (result: unknown) => void>();
    invoke.mockImplementation((channel: string, ...args: unknown[]) => {
      if (channel === 'overlay:prepare') return new Promise((resolve) => answers.set(args[3] as string, resolve));
      if (channel === 'overlay:cancel') answers.get(args[0] as string)?.({ ok: false, error: 'cancelled' });
      return Promise.resolve();
    });
    const abort = new AbortController();
    const loading = loadOverlayFiles(clip, [asset], [30, 1], abort.signal);
    await vi.waitFor(() => expect(answers.size).toBe(1));
    abort.abort();
    await expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    expect(invoke).toHaveBeenCalledWith('overlay:cancel', [...answers.keys()][0]);
  });

  it('asks for nothing when the export was cancelled before it got here', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(loadOverlayFiles(clip, [asset], [30, 1], abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(invoke).not.toHaveBeenCalled();
  });
});
