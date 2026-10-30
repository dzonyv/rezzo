/**
 * Frame-accurate decoding of a working file with WebCodecs, taken from the
 * Phase 0 export lab. To get frame N it decodes from the nearest keyframe
 * at or before N and throws away the frames before N.
 *
 * Every VideoFrame that comes out must be closed as soon as it isn't
 * needed: the hardware decoder has a small pool of output pictures, and
 * holding ~14 of them crashed the GPU process on a GTX 1660 (Phase 0).
 */
import type { Demuxed } from './demux.ts';

export class FrameSource {
  private decoder: VideoDecoder;
  private ready: VideoFrame[] = [];
  private wake: (() => void) | undefined;
  private error: Error | undefined;
  private dirty = false;
  /** While set, decoded frames before this index are closed on arrival. */
  private discardBefore: number | undefined;
  private readonly media: Demuxed;
  private readonly indexByTimestamp: Map<number, number>;

  constructor(media: Demuxed) {
    this.media = media;
    this.indexByTimestamp = new Map(media.samples.map((s, i) => [s.timestampUs, i]));
    this.decoder = new VideoDecoder({
      output: (frame) => {
        if (this.discardBefore !== undefined && this.indexOf(frame) < this.discardBefore) {
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

  /** Which frame of the working file this is. */
  indexOf(frame: VideoFrame): number {
    return this.indexByTimestamp.get(frame.timestamp) ?? -1;
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
        // let the caller notice instead of waiting forever.
        if (drained) return;
        await this.nextEvent();
        continue;
      }
      const index = this.indexOf(frame);
      if (index < wanted) {
        frame.close();
        continue;
      }
      wanted = index + 1;
      yield { frame, index };
    }
  }

  /** Decodes just frame `target`. The caller must close it. */
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
      if (this.indexOf(f) === target) found = f;
      else f.close();
    }
    if (!found) throw new Error(`seek(${target}): frame not produced`);
    return found;
  }

  close(): void {
    for (const f of this.ready.splice(0)) f.close();
    if (this.decoder.state !== 'closed') this.decoder.close();
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

  private keyframeAtOrBefore(index: number): number {
    for (let i = Math.min(index, this.frameCount - 1); i >= 0; i--) {
      if (this.media.samples[i]!.isKey) return i;
    }
    return 0;
  }

  private chunk(i: number): EncodedVideoChunk {
    const s = this.media.samples[i]!;
    return new EncodedVideoChunk({ type: s.isKey ? 'key' : 'delta', timestamp: s.timestampUs, duration: s.durationUs, data: s.data });
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
