/**
 * Frame-accurate decoding of the working file with WebCodecs.
 *
 * mp4box.js splits the MP4 into H.264 samples; VideoDecoder turns them into
 * VideoFrames on the GPU. To get frame N we start at the nearest keyframe at
 * or before N and decode forward, throwing away frames before N.
 */
import { readFile } from 'node:fs/promises';
import { createFile, DataStream, Endianness, MP4BoxBuffer, type Sample } from 'mp4box';
import { FPS } from '../layout.ts';

export interface Demuxed {
  config: VideoDecoderConfig;
  samples: { data: Uint8Array; timestampUs: number; durationUs: number; isKey: boolean }[];
}

export async function demux(file: string): Promise<Demuxed> {
  const bytes = await readFile(file);
  const mp4 = createFile();

  return new Promise((resolve, reject) => {
    let config: VideoDecoderConfig | undefined;
    const samples: Demuxed['samples'] = [];
    let expected = 0;

    mp4.onError = (_module, message) => reject(new Error(message));
    mp4.onReady = (info) => {
      const track = info.videoTracks[0];
      if (!track) return reject(new Error(`${file}: no video track`));
      expected = track.nb_samples;
      config = {
        codec: track.codec,
        codedWidth: track.video!.width,
        codedHeight: track.video!.height,
        description: avcDescription(mp4.getTrackById(track.id)),
        hardwareAcceleration: 'prefer-hardware',
        optimizeForLatency: true,
      };
      mp4.setExtractionOptions(track.id, undefined, { nbSamples: Infinity });
      mp4.start();
    };
    mp4.onSamples = (_id, _user, batch: Sample[]) => {
      for (const s of batch) {
        samples.push({
          data: s.data!,
          timestampUs: (s.cts * 1e6) / s.timescale,
          durationUs: (s.duration * 1e6) / s.timescale,
          isKey: s.is_sync,
        });
      }
      if (samples.length === expected) resolve({ config: config!, samples });
    };

    const buf = MP4BoxBuffer.fromArrayBuffer(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      0,
    );
    mp4.appendBuffer(buf);
    mp4.flush();
  });
}

/** The avcC box payload (without its 8-byte header) is what VideoDecoder wants as `description`. */
function avcDescription(trak: ReturnType<ReturnType<typeof createFile>['getTrackById']>): Uint8Array {
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    const box = (entry as { avcC?: { write(s: DataStream): void } }).avcC;
    if (box) {
      const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8);
    }
  }
  throw new Error('no avcC box');
}

export const frameIndexOf = (timestampUs: number): number => Math.round((timestampUs * FPS) / 1e6);

export class FrameSource {
  private decoder: VideoDecoder;
  private ready: VideoFrame[] = [];
  private wake: (() => void) | undefined;
  private error: Error | undefined;
  private dirty = false;
  /** While set, decoded frames before this index are closed on arrival. */
  private discardBefore: number | undefined;

  private media: Demuxed;

  constructor(media: Demuxed) {
    this.media = media;
    this.decoder = new VideoDecoder({
      output: (frame) => {
        // The hardware decoder has a small pool of output pictures; holding
        // on to ~14 of them crashed the GPU process on a GTX 1660.
        if (this.discardBefore !== undefined && frameIndexOf(frame.timestamp) < this.discardBefore) {
          frame.close();
          return;
        }
        this.ready.push(frame);
        this.notify();
      },
      error: (e) => {
        this.error = e;
        this.notify();
      },
    });
    this.decoder.addEventListener('dequeue', () => this.notify());
    this.decoder.configure(media.config);
  }

  get frameCount(): number {
    return this.media.samples.length;
  }

  /** Yields frames start..start+count-1 in order. The caller must close each frame. */
  async *frames(start: number, count: number): AsyncGenerator<{ frame: VideoFrame; index: number }> {
    await this.restart();
    this.dirty = true;
    let next = this.keyframeAtOrBefore(start);
    const end = Math.min(start + count, this.frameCount);
    let flushed = false;
    let drained = false;
    let wanted = start;

    while (wanted < end) {
      while (next < this.frameCount && this.decoder.decodeQueueSize < 4 && this.ready.length < 4) {
        this.decoder.decode(this.chunk(next++));
      }
      if (next >= this.frameCount && !flushed) {
        flushed = true;
        // Once the flush settles no more frames will come. It rejects if the
        // decoder is reset meanwhile, which only means the same.
        const done = () => {
          drained = true;
          this.notify();
        };
        this.decoder.flush().then(done, done);
      }
      const frame = this.ready.shift();
      if (!frame) {
        // Fewer frames than expected (a sample failed to decode): stop and
        // let the caller notice the shortfall instead of waiting forever.
        if (drained) return;
        await this.nextEvent();
        continue;
      }
      const index = frameIndexOf(frame.timestamp);
      if (index < wanted) {
        frame.close();
        continue;
      }
      wanted = index + 1;
      yield { frame, index };
    }
  }

  /** Decodes just frame `target`, as a scrubbing UI would. */
  async seek(target: number): Promise<VideoFrame> {
    await this.restart();
    const key = this.keyframeAtOrBefore(target);
    this.discardBefore = target;
    try {
      for (let i = key; i <= target; i++) this.decoder.decode(this.chunk(i));
      await this.decoder.flush();
    } finally {
      this.discardBefore = undefined;
    }
    this.dirty = false;
    this.throwIfFailed();
    let found: VideoFrame | undefined;
    for (const f of this.ready.splice(0)) {
      if (frameIndexOf(f.timestamp) === target) found = f;
      else f.close();
    }
    if (!found) throw new Error(`seek(${target}): frame not produced`);
    return found;
  }

  close(): void {
    for (const f of this.ready.splice(0)) f.close();
    this.decoder.close();
  }

  /**
   * Drops whatever is in flight so the next request starts from a keyframe.
   * After seek() the decoder is already drained by flush(), so back-to-back
   * seeks skip the (slow) reset and reconfigure.
   */
  private async restart(): Promise<void> {
    if (this.dirty) {
      this.decoder.reset();
      this.decoder.configure(this.media.config);
    }
    for (const f of this.ready.splice(0)) f.close();
  }

  /**
   * Working files are encoded without B-frames, so decode order equals
   * display order and sample i is frame i.
   */
  private keyframeAtOrBefore(index: number): number {
    for (let i = Math.min(index, this.frameCount - 1); i >= 0; i--) {
      if (this.media.samples[i].isKey) return i;
    }
    return 0;
  }

  private chunk(i: number): EncodedVideoChunk {
    const s = this.media.samples[i];
    return new EncodedVideoChunk({
      type: s.isKey ? 'key' : 'delta',
      timestamp: s.timestampUs,
      duration: s.durationUs,
      data: s.data,
    });
  }

  private notify(): void {
    const w = this.wake;
    this.wake = undefined;
    w?.();
  }

  private async nextEvent(): Promise<void> {
    this.throwIfFailed();
    await new Promise<void>((resolve) => (this.wake = resolve));
    this.throwIfFailed();
  }

  private throwIfFailed(): void {
    if (this.error) throw this.error;
  }
}
