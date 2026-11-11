/**
 * The player's timing, against a made-up audio clock and made-up timers:
 * every animation frame moves the clock on by 1/60 s, and the decoder hands
 * out frames at once. Only what the player schedules is looked at, not
 * what is drawn.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Compositor } from './compositor.ts';

vi.mock('./demux.ts', () => ({ demux: async () => ({ width: 2, height: 2 }) }));
vi.mock('./frame-source.ts', () => ({
  FrameSource: class {
    async seek() {
      return { close() {} };
    }
    async *frames(start: number, count: number) {
      for (let index = start; index < start + count; index++) yield { frame: { close() {} }, index };
    }
    close() {}
  },
}));

const { ClipPlayer } = await import('./clip-player.ts');

const TICK = 1 / 60;
/** An animation frame on the timers' clock, which is what a changed range waits on before playing again. */
const FRAME_MS = 1000 * TICK;
/** The audio clock, in seconds. */
let now = 0;
/** Every piece of sound the player started: when, how long, and when it was stopped (null: left to play out). */
let started: { at: number; length: number; stoppedAt: number | null }[] = [];

/** A gain's value over time as the player set it: [value, at] for setValueAtTime and each ramp after it. */
class FakeParam {
  points: [number, number][] = [];
  setValueAtTime(value: number, at: number) {
    this.points.push([value, at]);
  }
  linearRampToValueAtTime(value: number, at: number) {
    this.points.push([value, at]);
  }
}
/** Every gain the player made, in order. */
let gains: FakeParam[] = [];
class FakeNode {
  gain = new FakeParam();
  connect<T>(to: T): T {
    return to;
  }
  disconnect() {}
}
class FakeSource extends FakeNode {
  buffer: unknown = null;
  private entry: (typeof started)[number] | null = null;
  start(at: number, _offset: number, length: number) {
    this.entry = { at, length, stoppedAt: null };
    started.push(this.entry);
  }
  stop() {
    if (this.entry) this.entry.stoppedAt = now;
  }
}
class FakeContext {
  baseLatency = 0;
  outputLatency = 0;
  destination = new FakeNode();
  get currentTime() {
    return now;
  }
  async resume() {}
  async close() {}
  createBufferSource() {
    return new FakeSource();
  }
  createGain() {
    const node = new FakeNode();
    gains.push(node.gain);
    return node;
  }
}

const compositor = { sourceSize: { width: 2, height: 2 }, upload() {}, present() {} } as unknown as Compositor;
const file = { url: 'rezzo-media://file/?path=x', start: 0, end: 10, frameRate: [30, 1] as [number, number] };

/** Lets the player run until the audio clock reaches `time`. */
async function playUntil(time: number): Promise<void> {
  while (now < time - 1e-9) await vi.advanceTimersByTimeAsync(FRAME_MS);
}

beforeEach(() => {
  vi.useFakeTimers();
  now = 0;
  started = [];
  gains = [];
  vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('OfflineAudioContext', class {
    async decodeAudioData() {
      return { duration: 10 };
    }
  });
  vi.stubGlobal('DynamicsCompressorNode', FakeNode);
  vi.stubGlobal('GainNode', FakeNode);
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    setTimeout(() => {
      now += TICK;
      callback();
    }, FRAME_MS);
    return 0;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ClipPlayer', () => {
  it("turns a layer's sound down under speech by its own gain, through the duck's corners", async () => {
    const player = await ClipPlayer.load(file, compositor, { start: 0, end: 3, skips: [] }, () => {});
    const duck = [{ t: 0.85, gain: 1 }, { t: 1, gain: 0.25 }, { t: 2, gain: 0.25 }, { t: 2.4, gain: 1 }];
    const played = { envelope: { at: 0, length: 3, volume: 0.5, fadeIn: 0, fadeOut: 0 }, from: 0, loop: false, period: 3 };
    player.setSounds([{ buffer: { duration: 3 } as AudioBuffer, played, duck }]);
    gains = [];
    player.play();
    await playUntil(0.1);
    player.dispose();
    // The last two gains made are the sound's: its envelope, then the duck.
    const [envelope, ducked] = gains.slice(-2);
    expect(envelope!.points.every(([v]) => v === 0.5)).toBe(true);
    const values = ducked!.points.map(([v]) => v);
    expect(values).toEqual([1, 1, 0.25, 0.25, 1]);
    // On the context's clock, the corners are as far apart as in the clip.
    const times = ducked!.points.map(([, at]) => at);
    expect(times[2]! - times[1]!).toBeCloseTo(0.15);
    expect(times[4]! - times[3]!).toBeCloseTo(0.4);
  });

  it('plays the clip to its end before going around again', async () => {
    const player = await ClipPlayer.load(file, compositor, { start: 0, end: 1, skips: [] }, () => {});
    player.play();
    await playUntil(1.2);
    player.dispose();
    // The first time around was never stopped short: the second started when the first had played out.
    expect(started.length).toBeGreaterThanOrEqual(2);
    expect(started[0]).toMatchObject({ at: 0, length: 1 });
    expect(started[0]!.stoppedAt).toBeGreaterThanOrEqual(1 - 1e-9);
    expect(started[1]!.at).toBeGreaterThanOrEqual(1 - 1e-9);
  });

  it('plays to the new end when the clip is shortened while playing', async () => {
    // The same list of skips, as when only an end is dragged.
    const skips: never[] = [];
    const player = await ClipPlayer.load(file, compositor, { start: 0, end: 10, skips }, () => {});
    player.play();
    await playUntil(2);
    player.setRange({ start: 0, end: 5, skips });
    await playUntil(2.5);
    player.dispose();
    expect(started).toHaveLength(2);
    // From where it was (a little after 2 s) to the new end at 5 s.
    expect(started[1]!.length).toBeGreaterThan(2.6);
    expect(started[1]!.length).toBeLessThan(3);
  });

  it('starts again once, not at every step, while an end is being dragged', async () => {
    const skips: never[] = [];
    const player = await ClipPlayer.load(file, compositor, { start: 0, end: 10, skips }, () => {});
    player.play();
    await playUntil(1);
    for (let end = 9.9; end > 9; end -= 0.1) {
      player.setRange({ start: 0, end, skips });
      await playUntil(now + 2 * TICK);
    }
    expect(started).toHaveLength(1);
    await playUntil(now + 0.5);
    player.dispose();
    expect(started).toHaveLength(2);
  });

  it('forgets a restart that was waiting when playback is paused', async () => {
    const skips: never[] = [];
    const player = await ClipPlayer.load(file, compositor, { start: 0, end: 10, skips }, () => {});
    player.play();
    await playUntil(1);
    player.setRange({ start: 0, end: 5, skips });
    player.pause();
    await vi.advanceTimersByTimeAsync(1000);
    player.dispose();
    expect(started).toHaveLength(1);
    expect(player.isPlaying).toBe(false);
  });

  it('keeps playing as it was when the same range is set again', async () => {
    const skips: never[] = [];
    const player = await ClipPlayer.load(file, compositor, { start: 0, end: 10, skips }, () => {});
    player.play();
    await playUntil(1);
    player.setRange({ start: 0, end: 10, skips });
    await playUntil(1.2);
    player.dispose();
    expect(started).toHaveLength(1);
  });
});
