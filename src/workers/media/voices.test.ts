import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({}));
const { pcmOf } = await import('./voices.ts');

/** A 16 kHz mono WAV with FFmpeg's LIST chunk before the data. */
function wav(samples: number[]): Uint8Array {
  const list = Buffer.from('LIST\x04\x00\x00\x00INFO', 'latin1');
  const data = Buffer.alloc(8 + samples.length * 2);
  data.write('data', 0, 'latin1');
  data.writeUInt32LE(samples.length * 2, 4);
  samples.forEach((s, i) => data.writeInt16LE(s, 8 + 2 * i));
  const header = Buffer.alloc(36);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(4 + 24 + list.length + data.length, 4);
  header.write('WAVEfmt ', 8, 'latin1');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  // Odd byte offset inside a bigger buffer, as Node's file reads can give.
  const all = Buffer.concat([Buffer.alloc(1), header, list, data]);
  return all.subarray(1);
}

describe('reading the audio', () => {
  it('reads a stretch as floats, past the LIST chunk', () => {
    const pcm = pcmOf(wav(Array.from({ length: 32000 }, (_, i) => (i % 2 ? 16384 : -16384))));
    expect(pcm.length).toBe(32000);
    const piece = pcm.samples(0.5, 0.5 + 4 / 16000);
    expect(Array.from(piece)).toEqual([-0.5, 0.5, -0.5, 0.5]);
  });

  it('keeps a stretch inside the file', () => {
    const pcm = pcmOf(wav([1000, 2000]));
    expect(pcm.samples(-1, 5)).toHaveLength(2);
    expect(pcm.samples(3, 4)).toHaveLength(0);
  });

  it('refuses a file without audio data', () => {
    expect(() => pcmOf(new Uint8Array(44))).toThrow('no data chunk');
  });
});
