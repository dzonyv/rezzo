/**
 * Plays a clip from its working file through the compositor.
 *
 * The working file is fetched once; its video goes to WebCodecs and its
 * audio to Web Audio. While playing, the audio clock decides which frame is
 * due: frames that come too late are skipped, never the sound. While paused,
 * seeks are merged so only the latest one is decoded.
 *
 * Times are source seconds, like everywhere in the project. Each frame is
 * drawn with the framing at that frame's own time, as the export will.
 */
import type { FrameRecipe, Size } from '../../../shared/framing.ts';
import { fps, type FrameRate } from '../../../shared/frames.ts';
import { workingFrameIndex, workingFrameTime } from '../../../shared/working.ts';
import type { Compositor } from './compositor.ts';
import { demux } from './demux.ts';
import { FrameSource } from './frame-source.ts';

/** Where the working file sits in the source: frame 0 is at `start`, and it holds frames up to `end`. */
export interface WorkingFile {
  url: string;
  start: number;
  end: number;
  frameRate: FrameRate;
}

export type RecipeAt = (time: number, source: Size) => FrameRecipe;

/** Loudness values per second of sound in Peaks. */
export const PEAKS_PER_SECOND = 100;

/** How loud the sound is: the highest sample (0..1) in each 1/PEAKS_PER_SECOND s, from the working file's start. */
export type Peaks = Float32Array;

function peaksOf(audio: AudioBuffer): Peaks {
  const step = audio.sampleRate / PEAKS_PER_SECOND;
  const out = new Float32Array(Math.ceil(audio.length / step));
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const b = Math.floor(i / step);
      const v = Math.abs(data[i]!);
      if (v > out[b]!) out[b] = v;
    }
  }
  return out;
}

const nextAnimationFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export class ClipPlayer {
  /** Called whenever the time or the playing state changes. */
  onTime: ((time: number, playing: boolean) => void) | undefined;
  onError: ((error: unknown) => void) | undefined;

  readonly file: WorkingFile;
  /** The picture size in the working file (after FFmpeg rotated or scaled it). */
  readonly size: Size;
  private readonly compositor: Compositor;
  private readonly frames: FrameSource;
  private readonly audio: AudioBuffer | null;
  private readonly context = new AudioContext({ latencyHint: 'interactive' });
  private node: AudioBufferSourceNode | null = null;

  private range: { start: number; end: number };
  private recipeAt: RecipeAt;
  private time: number;
  private playing = false;
  /** Bumped to stop the running playback loop. */
  private run = 0;
  /** Frame shown on the canvas, -1 for none. */
  private shown = -1;
  /** Frame a paused seek still has to show. */
  private wanted: number | null = null;
  /** Decoder jobs run one at a time, in order. */
  private lock: Promise<void> = Promise.resolve();
  private disposed = false;

  private constructor(file: WorkingFile, size: Size, compositor: Compositor, frames: FrameSource, audio: AudioBuffer | null, range: { start: number; end: number }, recipeAt: RecipeAt) {
    this.file = file;
    this.size = size;
    this.compositor = compositor;
    this.frames = frames;
    this.audio = audio;
    this.range = range;
    this.recipeAt = recipeAt;
    this.time = range.start;
  }

  static async load(file: WorkingFile, compositor: Compositor, range: { start: number; end: number }, recipeAt: RecipeAt): Promise<ClipPlayer> {
    const response = await fetch(file.url);
    if (!response.ok) throw new Error(`loading the working file failed: ${response.status}`);
    const bytes = await response.arrayBuffer();
    const media = await demux(bytes);
    // decodeAudioData takes the buffer over, so it gets a copy. No audio track: a silent clip.
    const audio = await new OfflineAudioContext(2, 1, 48_000).decodeAudioData(bytes.slice(0)).catch(() => null);
    const size = { width: media.width, height: media.height };
    const player = new ClipPlayer(file, size, compositor, new FrameSource(media), audio, range, recipeAt);
    player.seek(range.start);
    return player;
  }

  private peakCache: Peaks | null | undefined;

  /** The sound's loudness for drawing a waveform, worked out on first use; null without sound. */
  get peaks(): Peaks | null {
    if (this.peakCache === undefined) this.peakCache = this.audio ? peaksOf(this.audio) : null;
    return this.peakCache;
  }

  /** False for a clip without sound; it then plays on the system clock. */
  get hasAudio(): boolean {
    return this.audio !== null;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get currentTime(): number {
    return this.time;
  }

  /** The clip's range in the source; playback stays inside it. */
  get clipRange(): { start: number; end: number } {
    return this.range;
  }

  setRange(range: { start: number; end: number }): void {
    this.range = range;
    if (this.time < range.start || this.time >= range.end) this.seek(range.start);
  }

  /** New framing: redraws the frame on screen when paused. */
  setRecipe(recipeAt: RecipeAt): void {
    this.recipeAt = recipeAt;
    if (!this.playing && this.shown >= 0) this.draw(this.shown);
  }

  seek(time: number): void {
    this.time = this.clampToRange(time);
    this.emit();
    if (this.playing) {
      this.startPlaying();
    } else {
      this.wanted = this.frameAt(this.time);
      void this.exclusive(() => this.showWanted());
    }
  }

  play(): void {
    if (this.playing) return;
    // From the end, play starts over.
    if (this.frameAt(this.time) >= this.frameAt(this.range.end) - 1) this.time = this.range.start;
    this.playing = true;
    this.startPlaying();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.run++;
    this.stopAudio();
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  dispose(): void {
    this.disposed = true;
    this.pause();
    this.run++;
    void this.lock.then(() => this.frames.close());
    void this.context.close();
  }

  private frameAt(time: number): number {
    return workingFrameIndex(this.file, time);
  }

  private timeOf(frame: number): number {
    return workingFrameTime(this.file, frame);
  }

  private clampToRange(time: number): number {
    const last = this.timeOf(this.frameAt(this.range.end) - 1);
    return Math.min(Math.max(time, this.range.start), Math.max(this.range.start, last));
  }

  private emit(): void {
    this.onTime?.(this.time, this.playing);
  }

  private exclusive(job: () => Promise<void>): Promise<void> {
    const next = this.lock.then(job).catch((e: unknown) => {
      if (!this.disposed) this.onError?.(e);
    });
    this.lock = next;
    return next;
  }

  private draw(frame: number): void {
    const size = this.compositor.sourceSize;
    if (!size) return;
    this.compositor.render(this.recipeAt(this.timeOf(frame), size));
    this.compositor.present();
  }

  private show(frame: VideoFrame, index: number): void {
    this.compositor.upload(frame);
    frame.close();
    this.shown = index;
    this.draw(index);
  }

  private async showWanted(): Promise<void> {
    while (!this.playing && !this.disposed && this.wanted !== null && this.wanted !== this.shown) {
      const target = this.wanted;
      const frame = await this.frames.seek(target);
      if (this.playing || this.disposed) {
        frame.close();
        return;
      }
      this.show(frame, target);
    }
    this.wanted = null;
  }

  private startPlaying(): void {
    const run = ++this.run;
    this.stopAudio();
    const from = this.time;
    void this.exclusive(() => this.playFrom(from, run));
  }

  /** The source time being heard now. */
  private clock: () => number = () => this.time;

  private async playFrom(from: number, run: number): Promise<void> {
    if (run !== this.run) return;
    await this.context.resume();
    const first = this.frameAt(from);
    const end = this.frameAt(this.range.end);
    if (run !== this.run) return;
    if (first >= end) {
      this.pause();
      return;
    }
    // Audio reaches the speakers this much after the context renders it.
    const latency = this.audio ? this.context.baseLatency + (this.context.outputLatency || 0) : 0;
    const startedAt = this.audio ? this.context.currentTime : performance.now() / 1000;
    const now = this.audio ? () => this.context.currentTime : () => performance.now() / 1000;
    this.clock = () => from + Math.max(0, now() - startedAt - latency);
    if (this.audio) {
      const node = this.context.createBufferSource();
      node.buffer = this.audio;
      node.connect(this.context.destination);
      node.start(0, Math.max(0, from - this.file.start));
      this.node = node;
    }

    const frameSeconds = 1 / fps(this.file.frameRate);
    for await (const { frame, index } of this.frames.frames(first, end - first)) {
      if (run !== this.run) {
        frame.close();
        return;
      }
      const due = this.timeOf(index);
      while (this.clock() < due - frameSeconds / 2) {
        await nextAnimationFrame();
        if (run !== this.run) {
          frame.close();
          return;
        }
      }
      // Too late to show: skip it and catch up with the sound.
      if (this.clock() > due + frameSeconds && index < end - 1) {
        frame.close();
        continue;
      }
      this.show(frame, index);
      this.time = due;
      this.emit();
    }
    if (run !== this.run) return;
    // The end of the clip: around again from the start.
    this.time = this.range.start;
    this.startPlaying();
  }

  private stopAudio(): void {
    this.node?.stop();
    this.node?.disconnect();
    this.node = null;
  }
}
