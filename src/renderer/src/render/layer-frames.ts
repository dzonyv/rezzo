/**
 * Video layers' frames, decoded in step with the clip. Each video layer
 * gets its own FrameSource on its working file (render/overlay-files.ts);
 * for a moment of the clip the scene says which second of the file each
 * layer shows (overlayTimeAt), and that frame goes into the compositor.
 *
 * While playing, each layer's decoder runs forward alongside the clip's;
 * a jump (a loop starting over, a seek) restarts it from the nearest
 * keyframe. While paused, each frame is a seek of its own. Frames are
 * uploaded and closed right away: the hardware decoder's pool is small.
 */
import { MAX_VIDEO_LAYERS } from '../../../shared/overlay-files.ts';
import type { SceneOp } from '../../../shared/scene.ts';
import { workingFrameIndex } from '../../../shared/working.ts';
import type { Compositor } from './compositor.ts';
import { demux } from './demux.ts';
import { FrameSource } from './frame-source.ts';
import { workingFileBytes, WorkingFileGoneError, type OverlayFile } from './overlay-files.ts';

/** Further ahead than this, playback restarts the decoder rather than decoding its way there. */
const MAX_FORWARD = 30;

type Frames = AsyncGenerator<{ frame: VideoFrame; index: number }>;

interface Entry {
  file: OverlayFile;
  /** The decoder, once the file is fetched and split; rejects if that fails. */
  source: Promise<FrameSource>;
  /** The forward decoder while playing, and the index of the next frame it gives. */
  frames: Frames | null;
  next: number;
  /** Frame in the compositor, -1 for none. */
  shown: number;
  failed: boolean;
}

async function open(file: OverlayFile): Promise<FrameSource> {
  return new FrameSource(await demux(await workingFileBytes(file.url)));
}

export class LayerFrames {
  /**
   * Called once per layer whose file can't be decoded; that layer is then
   * left out. A WorkingFileGoneError leaves it out only until its file comes
   * back under the same URL.
   */
  onError: ((layerId: string, error: unknown) => void) | undefined;

  private readonly compositor: Compositor;
  private readonly entries = new Map<string, Entry>();

  constructor(compositor: Compositor) {
    this.compositor = compositor;
  }

  /**
   * Puts the right frame of every video layer in `ops` into the compositor.
   * `sequential`: the clip is playing forward, so decoders keep running.
   * Resolves true when any layer's frame changed.
   */
  async prepare(ops: readonly SceneOp[], files: ReadonlyMap<string, OverlayFile>, sequential: boolean): Promise<boolean> {
    this.forgetAllBut(files);
    const showing = ops.flatMap((op) => (op.type === 'overlay' ? [op] : [])).slice(0, MAX_VIDEO_LAYERS);
    const changed = await Promise.all(
      showing.map(async (op) => {
        const file = files.get(op.layerId);
        if (!file) return false;
        const entry = this.entryFor(op.layerId, file);
        if (entry.failed) return false;
        try {
          const source = await entry.source;
          const index = Math.min(Math.max(workingFrameIndex(file, op.time), 0), source.frameCount - 1);
          if (index === entry.shown) return false;
          const frame = sequential ? await this.forward(entry, source, index) : await this.seek(entry, source, index);
          if (this.entries.get(op.layerId) !== entry) {
            frame.close();
            return false;
          }
          this.compositor.uploadLayerFrame(op.layerId, frame, file.layout);
          frame.close();
          entry.shown = index;
          return true;
        } catch (e) {
          // A file that's gone can come back (made again) under the same URL; anything else won't get better.
          if (e instanceof WorkingFileGoneError) this.forget(op.layerId);
          else entry.failed = true;
          this.onError?.(op.layerId, e);
          return false;
        }
      }),
    );
    return changed.some(Boolean);
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.forget(id);
  }

  private entryFor(layerId: string, file: OverlayFile): Entry {
    const held = this.entries.get(layerId);
    if (held && held.file.url === file.url) return held;
    if (held) this.forget(layerId);
    const entry: Entry = { file, source: open(file), frames: null, next: -1, shown: -1, failed: false };
    // A failure surfaces in prepare(); this keeps it from also counting as unhandled.
    entry.source.catch(() => {});
    this.entries.set(layerId, entry);
    return entry;
  }

  /** Playing: frame `index` from the running decoder, or from a fresh one after a jump. */
  private async forward(entry: Entry, source: FrameSource, index: number): Promise<VideoFrame> {
    if (!entry.frames || index < entry.next || index - entry.next > MAX_FORWARD) {
      void entry.frames?.return(undefined);
      entry.frames = source.frames(index, source.frameCount - index);
    }
    for (;;) {
      const r = await entry.frames.next();
      if (r.done) throw new Error(`a video layer's file ended before frame ${index}`);
      entry.next = r.value.index + 1;
      if (r.value.index >= index) return r.value.frame;
      r.value.frame.close();
    }
  }

  /** Paused: just frame `index`. */
  private async seek(entry: Entry, source: FrameSource, index: number): Promise<VideoFrame> {
    void entry.frames?.return(undefined);
    entry.frames = null;
    return source.seek(index);
  }

  private forgetAllBut(files: ReadonlyMap<string, OverlayFile>): void {
    for (const id of [...this.entries.keys()]) if (!files.has(id)) this.forget(id);
  }

  private forget(layerId: string): void {
    const entry = this.entries.get(layerId);
    if (!entry) return;
    this.entries.delete(layerId);
    void entry.frames?.return(undefined);
    void entry.source.then((s) => s.close(), () => {});
    this.compositor.keepLayerFrames(new Set(this.entries.keys()));
  }
}
