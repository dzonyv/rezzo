/**
 * Plays a clip from its working file through the compositor.
 *
 * The working file is fetched once; its video goes to WebCodecs and its
 * audio to Web Audio, where the video layers' sound joins it (setSounds). While playing, the audio clock decides which frame is
 * due: frames that come too late are skipped, never the sound. While paused,
 * seeks are merged so only the latest one is decoded.
 *
 * Times are source seconds, like everywhere in the project. Each frame is
 * drawn with everything in the clip at that frame's own time, as the
 * export does. What takes time to get ready for a frame (video layers'
 * frames) is prepared before the frame is shown.
 */
import type { Size } from '../../../shared/framing.ts';
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

/** Draws the clip at a moment into the compositor, over the source frame it has (see SceneRenderer). */
export type DrawAt = (time: number) => void;

/**
 * Gets what DrawAt needs for a moment ready (see SceneRenderer.prepare);
 * `sequential` while playing forward. Resolves true when something changed.
 */
export type PrepareAt = (time: number, sequential: boolean) => Promise<boolean>;

const nothingToPrepare: PrepareAt = () => Promise.resolve(false);

/**
 * A video layer's sound: its working file's audio, the stretches of it
 * that play (`at` in source seconds, `from` seconds into `buffer`) and
 * how loud.
 */
export interface LayerSound {
  buffer: AudioBuffer;
  pieces: { at: number; from: number; duration: number }[];
  volume: number;
}

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
  private sounds: LayerSound[] = [];
  private soundNodes: AudioBufferSourceNode[] = [];
  /** While playing: the audio context's time at which source time `time` was rendered. */
  private origin: { contextTime: number; time: number } | null = null;

  private range: { start: number; end: number };
  private drawAt: DrawAt;
  private prepareAt: PrepareAt = nothingToPrepare;
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

  private constructor(file: WorkingFile, size: Size, compositor: Compositor, frames: FrameSource, audio: AudioBuffer | null, range: { start: number; end: number }, drawAt: DrawAt) {
    this.file = file;
    this.size = size;
    this.compositor = compositor;
    this.frames = frames;
    this.audio = audio;
    this.range = range;
    this.drawAt = drawAt;
    this.time = range.start;
  }

  static async load(file: WorkingFile, compositor: Compositor, range: { start: number; end: number }, drawAt: DrawAt): Promise<ClipPlayer> {
    const response = await fetch(file.url);
    if (!response.ok) throw new Error(`loading the working file failed: ${response.status}`);
    const bytes = await response.arrayBuffer();
    const media = await demux(bytes);
    // decodeAudioData takes the buffer over, so it gets a copy. No audio track: a silent clip.
    const audio = await new OfflineAudioContext(2, 1, 48_000).decodeAudioData(bytes.slice(0)).catch(() => null);
    const size = { width: media.width, height: media.height };
    const player = new ClipPlayer(file, size, compositor, new FrameSource(media), audio, range, drawAt);
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

  /**
   * Something to draw changed (framing, captions, layers): redraws the frame
   * on screen when paused, at once, and again if the change needed a video
   * layer's frame decoded.
   */
  setScene(drawAt: DrawAt, prepareAt: PrepareAt = nothingToPrepare): void {
    this.drawAt = drawAt;
    this.prepareAt = prepareAt;
    if (this.playing || this.shown < 0) return;
    const shown = this.shown;
    this.draw(shown);
    void this.exclusive(async () => {
      if ((await this.prepareAt(this.timeOf(shown), false)) && !this.playing && this.shown === shown) this.draw(shown);
    });
  }

  /** The video layers' sound; while playing it's rescheduled from where playback is. */
  setSounds(sounds: LayerSound[]): void {
    this.sounds = sounds;
    if (!this.origin) return;
    this.stopSounds();
    const { contextTime, time } = this.origin;
    this.startSounds(time + (this.context.currentTime - contextTime));
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
    if (!this.compositor.sourceSize) return;
    this.drawAt(this.timeOf(frame));
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
      await this.prepareAt(this.timeOf(target), false).catch((e: unknown) => {
        frame.close();
        throw e;
      });
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
    this.origin = { contextTime: this.context.currentTime, time: from };
    const now = this.audio ? () => this.context.currentTime : () => performance.now() / 1000;
    this.clock = () => from + Math.max(0, now() - startedAt - latency);
    if (this.audio) {
      const node = this.context.createBufferSource();
      node.buffer = this.audio;
      node.connect(this.context.destination);
      node.start(0, Math.max(0, from - this.file.start));
      this.node = node;
    }
    this.startSounds(from);

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
      try {
        await this.prepareAt(due, true);
      } catch (e) {
        frame.close();
        throw e;
      }
      if (run !== this.run) {
        frame.close();
        return;
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
    this.stopSounds();
    this.origin = null;
  }

  /** Schedules every stretch of the layers' sound from source time `from` to the end of the clip. */
  private startSounds(from: number): void {
    const origin = this.origin;
    if (!origin) return;
    const now = this.context.currentTime;
    for (const sound of this.sounds) {
      if (sound.volume <= 0) continue;
      for (const piece of sound.pieces) {
        let start = Math.max(piece.at, from);
        const end = Math.min(piece.at + piece.duration, this.range.end);
        let when = origin.contextTime + (start - origin.time);
        // Already due: start now, that much further in.
        if (when < now) {
          start += now - when;
          when = now;
        }
        if (end - start <= 0.001) continue;
        const node = this.context.createBufferSource();
        node.buffer = sound.buffer;
        const gain = this.context.createGain();
        gain.gain.value = sound.volume;
        node.connect(gain).connect(this.context.destination);
        node.start(when, piece.from + (start - piece.at), end - start);
        this.soundNodes.push(node);
      }
    }
  }

  private stopSounds(): void {
    for (const node of this.soundNodes.splice(0)) {
      node.stop();
      node.disconnect();
    }
  }
}
