import { describe, expect, it, vi } from 'vitest';

const callWorker = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ app: { getGPUInfo: async () => ({ gpuDevice: [{ vendorId: 0x10de }] }) } }));
vi.mock('../node/tools/download.ts', () => ({ isInstalled: async () => true }));
vi.mock('./paths.ts', () => ({ cacheDir: () => 'C:\\cache', downloadedToolDir: (id: string) => `C:\\tools\\${id}` }));
vi.mock('./worker-host.ts', () => ({ callWorker }));

const source = {
  path: 'C:\\video.mp4',
  size: 1000,
  fingerprint: 'a'.repeat(64),
  duration: 10,
  video: { codec: 'h264', width: 1280, height: 720, frameRate: [30, 1], variableFrameRate: false, colorSpace: null },
  audio: { codec: 'aac', sampleRate: 48000, channels: 2 },
};
const sender = { isDestroyed: () => false, send: () => {} } as unknown as Electron.WebContents;

describe('startTranscription', () => {
  it('always asks Whisper for sr, whatever the request says', async () => {
    const transcript = { language: 'sr', model: 'm', createdAt: new Date().toISOString(), startShift: -0.1, segments: [] };
    callWorker.mockResolvedValue(transcript);
    const { startTranscription } = await import('./transcription.ts');

    const result = await startTranscription(sender, { projectId: crypto.randomUUID(), source, language: 'hr' });

    expect(result).toEqual({ ok: true, transcript });
    const [job, [request]] = callWorker.mock.calls.at(-1)!;
    expect(job).toBe('transcribe');
    expect(request.language).toBe('sr');
  });
});
