/**
 * Plays a clip from its working file through the compositor.
 *
 * The working file is fetched once; its video goes to WebCodecs and its
 * audio to Web Audio, where the video layers' sound joins it (setSounds).
 * While playing, the audio clock decides which frame is due: frames that
 * come too late are skipped, never the sound. While paused, seeks are
 * merged so only the latest one is decoded.
 *
 * Times are source seconds, like everywhere in the project. Each frame is
 * drawn with everything in the clip at that frame's own time, as the
 * export does. What takes time to get ready for a frame (video layers'
 * frames) is prepared before the frame is shown.
 *
 * Playback goes from one kept piece of the clip to the next (shared/skips.ts).
 * The sound is scheduled ahead, piece after piece, so the clock it gives is
 * output time, and frames are compared with it in output time. A paused
 * playhead may stand inside a skip, to see what was cut.
 */
import type { Size } from '../../../shared/framing.ts';
import { fps, type FrameRate } from '../../../shared/frames.ts';
import { JOIN_FADE_SECONDS, keptLength, keptPieces, nextKept, outputTime, type ClipSpan } from '../../../shared/skips.ts';
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
 * that play (`at` in output time, `from` seconds into `buffer`) and how
 * loud.
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

/** Seconds per value in Loudness. */
export const LOUDNESS_STEP = 0.02;

/** How loud the sound is in dB, one value per LOUDNESS_STEP from the working file's start: for finding pauses. */
function loudnessOf(audio: AudioBuffer): Float32Array {
  const step = Math.round(audio.sampleRate * LOUDNESS_STEP);
  const out = new Float32Array(Math.floor(audio.length / step));
  const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
  for (let b = 0; b < out.length; b++) {
    let sum = 0;
    for (const data of channels) for (let i = b * step; i < (b + 1) * step; i++) sum += data[i]! * data[i]!;
    out[b] = 10 * Math.log10(Math.max(sum / (step * channels.length), 1e-10));
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
  private nodes: AudioBufferSourceNode[] = [];
  private sounds: LayerSound[] = [];
  private soundNodes: AudioBufferSourceNode[] = [];
  /** While playing: the audio context's time at which output time `time` was rendered. */
  private origin: { contextTime: number; time: number } | null = null;

  private range: ClipSpan;
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

  private constructor(file: WorkingFile, size: Size, compositor: Compositor, frames: FrameSource, audio: AudioBuffer | null, range: ClipSpan, drawAt: DrawAt) {
    this.file = file;
    this.size = size;
    this.compositor = compositor;
    this.frames = frames;
    this.audio = audio;
    this.range = range;
    this.drawAt = drawAt;
    this.time = range.start;
  }

  static async load(file: WorkingFile, compositor: Compositor, range: ClipSpan, drawAt: DrawAt): Promise<ClipPlayer> {
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

  private loudnessCache: Float32Array | null | undefined;

  /** The sound's loudness for finding pauses, worked out on first use; null without sound. */
  get loudness(): Float32Array | null {
    if (this.loudnessCache === undefined) this.loudnessCache = this.audio ? loudnessOf(this.audio) : null;
    return this.loudnessCache;
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
  get clipRange(): ClipSpan {
    return this.range;
  }

  setRange(range: ClipSpan): void {
    const skipsChanged = range.skips !== this.range.skips;
    this.range = range;
    if (this.time < range.start || this.time >= range.end) this.seek(range.start);
    else if (skipsChanged && this.playing) this.startPlaying();
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
    if (this.frameAt(this.time) >= this.frameAt(this.range.end) - 1 || nextKept(this.range, this.time) === null) this.time = this.range.start;
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

  /** The output time being heard now. */
  private clock: () => number = () => this.time;

  private async playFrom(from: number, run: number): Promise<void> {
    if (run !== this.run) return;
    await this.context.resume();
    if (run !== this.run) return;
    const range = this.range;
    const start = nextKept(range, from);
    const pieces = start === null ? [] : keptPieces(range).filter((p) => p.end > start).map((p) => ({ start: Math.max(p.start, start), end: p.end }));
    const spans = pieces.map((p) => ({ first: this.frameAt(p.start), end: this.frameAt(p.end) })).filter((s) => s.first < s.end);
    const last = spans.at(-1)?.end;
    if (start === null || last === undefined) {
      this.pause();
      return;
    }
    // Audio reaches the speakers this much after the context renders it.
    const latency = this.audio ? this.context.baseLatency + (this.context.outputLatency || 0) : 0;
    const startedAt = this.audio ? this.context.currentTime : performance.now() / 1000;
    const fromOutput = outputTime(range, start);
    this.origin = { contextTime: this.context.currentTime, time: fromOutput };
    const now = this.audio ? () => this.context.currentTime : () => performance.now() / 1000;
    this.clock = () => fromOutput + Math.max(0, now() - startedAt - latency);
    if (this.audio) this.startClipSound(this.audio, pieces, this.context.currentTime);
    this.startSounds(fromOutput);

    const frameSeconds = 1 / fps(this.file.frameRate);
    for (const span of spans) {
      for await (const { frame, index } of this.frames.frames(span.first, span.end - span.first)) {
        if (run !== this.run) {
          frame.close();
          return;
        }
        const due = this.timeOf(index);
        const dueOutput = outputTime(range, due);
        while (this.clock() < dueOutput - frameSeconds / 2) {
          await nextAnimationFrame();
          if (run !== this.run) {
            frame.close();
            return;
          }
        }
        // Too late to show: skip it and catch up with the sound.
        if (this.clock() > dueOutput + frameSeconds && index < last - 1) {
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
    }
    if (run !== this.run) return;
    // The end of the clip: around again from the start.
    this.time = this.range.start;
    this.startPlaying();
  }

  /** Schedules the clip's own sound from `when`: the pieces end to end, faded where they join. */
  private startClipSound(audio: AudioBuffer, pieces: readonly { start: number; end: number }[], when: number): void {
    let at = when;
    pieces.forEach((piece, i) => {
      const length = piece.end - piece.start;
      const isLast = i === pieces.length - 1;
      const node = this.context.createBufferSource();
      node.buffer = audio;
      const gain = this.context.createGain();
      if (i > 0) {
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(1, at + JOIN_FADE_SECONDS);
      }
      if (!isLast) {
        gain.gain.setValueAtTime(1, at + length - JOIN_FADE_SECONDS);
        gain.gain.linearRampToValueAtTime(0, at + length);
      }
      node.connect(gain).connect(this.context.destination);
      const offset = Math.max(0, piece.start - this.file.start);
      if (isLast) node.start(at, offset);
      else node.start(at, offset, length);
      this.nodes.push(node);
      at += length;
    });
  }

  private stopAudio(): void {
    for (const node of this.nodes.splice(0)) {
      node.stop();
      node.disconnect();
    }
    this.stopSounds();
    this.origin = null;
  }

  /** Schedules every stretch of the layers' sound from output time `from` to the end of the clip. */
  private startSounds(from: number): void {
    const origin = this.origin;
    if (!origin) return;
    const now = this.context.currentTime;
    for (const sound of this.sounds) {
      if (sound.volume <= 0) continue;
      for (const piece of sound.pieces) {
        let start = Math.max(piece.at, from);
        const end = Math.min(piece.at + piece.duration, keptLength(this.range));
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
